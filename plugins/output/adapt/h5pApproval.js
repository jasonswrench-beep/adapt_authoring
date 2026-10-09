// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Approval list for H5P files.
 *
 * An .h5p file is a program (it contains JavaScript), so an uploaded file is only unpacked into a course once
 * an administrator has approved that exact file. Files are identified by the SHA-256 of their bytes: approving
 * one file approves nothing else, and a changed file needs approving again.
 *
 * State is one small JSON file (in the data folder, so it survives restarts and sits in the Docker volume).
 * Kept free of app dependencies so it can be unit tested.
 */
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

const HASH = /^[a-f0-9]{64}$/;
const isHash = value => typeof value === 'string' && HASH.test(value);

/** SHA-256 of a file, streamed so large files do not need to fit in memory. */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

class ApprovalStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve(); // serialises read-modify-write so concurrent requests cannot lose updates
  }

  async _read() {
    try {
      const state = await fs.readJson(this.filePath);
      return { approved: state.approved || {}, rejected: state.rejected || {}, pending: state.pending || {} };
    } catch (error) {
      if (error.code === 'ENOENT') return { approved: {}, rejected: {}, pending: {} };
      throw error;
    }
  }

  async _write(state) {
    await fs.ensureDir(path.dirname(this.filePath));
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeJson(temp, state, { spaces: 2 });
    await fs.move(temp, this.filePath, { overwrite: true }); // atomic replace
  }

  /** Runs fn(state) exclusively and saves the state it leaves behind. */
  _update(fn) {
    const run = this.queue.then(async () => {
      const state = await this._read();
      const result = await fn(state);
      await this._write(state);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /** @returns {Promise<'approved'|'rejected'|'pending'|'unknown'>} */
  async statusOf(hash) {
    const state = await this._read();
    if (state.approved[hash]) return 'approved';
    if (state.rejected[hash]) return 'rejected';
    return state.pending[hash] ? 'pending' : 'unknown';
  }

  /**
   * Notes that a file is waiting for a decision, and where it was seen. Never changes an existing decision.
   * @param {string} hash
   * @param {{fileName: string, size: number, title: string, mainLibrary: string, libraries: string[]}} info
   * @param {{courseId: string, courseTitle: string}} [seenIn]
   */
  recordPending(hash, info, seenIn) {
    if (!isHash(hash)) return Promise.reject(new Error('Invalid file hash'));
    return this._update(state => {
      if (state.approved[hash] || state.rejected[hash]) return;
      const entry = state.pending[hash] || Object.assign({ firstSeen: new Date().toISOString(), seenIn: [] }, info);
      if (seenIn && seenIn.courseId && !entry.seenIn.some(c => c.courseId === seenIn.courseId)) entry.seenIn.push(seenIn);
      state.pending[hash] = entry;
    });
  }

  /** Approves a file that has been seen (pending or rejected). Resolves false if the hash is unknown. */
  approve(hash, by) {
    return this._decide(hash, by, 'approved');
  }

  reject(hash, by) {
    return this._decide(hash, by, 'rejected');
  }

  _decide(hash, by, decision) {
    if (!isHash(hash)) return Promise.reject(new Error('Invalid file hash'));
    return this._update(state => {
      const entry = state.pending[hash] || state.approved[hash] || state.rejected[hash];
      if (!entry) return false;
      delete state.pending[hash];
      delete state.approved[hash];
      delete state.rejected[hash];
      state[decision][hash] = Object.assign({}, entry, { decidedBy: by || 'unknown', decidedAt: new Date().toISOString() });
      return true;
    });
  }

  /** Forgets a decision; the file becomes pending again the next time a course using it is built. */
  revoke(hash) {
    if (!isHash(hash)) return Promise.reject(new Error('Invalid file hash'));
    return this._update(state => {
      const known = Boolean(state.approved[hash] || state.rejected[hash]);
      delete state.approved[hash];
      delete state.rejected[hash];
      return known;
    });
  }

  /** @returns {Promise<{pending: object[], approved: object[], rejected: object[]}>} each entry includes its hash */
  async list() {
    const state = await this._read();
    const rows = group => Object.keys(group).map(hash => Object.assign({ hash }, group[hash]));
    return { pending: rows(state.pending), approved: rows(state.approved), rejected: rows(state.rejected) };
  }
}

const stores = new Map();

/** One store per file, so every request in this process shares the same write queue. */
function storeFor(filePath) {
  if (!stores.has(filePath)) stores.set(filePath, new ApprovalStore(filePath));
  return stores.get(filePath);
}

module.exports = { ApprovalStore, storeFor, hashFile, isHash };
