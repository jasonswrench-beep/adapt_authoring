// Request signing between the course tool and the editor service. The course tool is the only way in: it checks who
// the user is and whether they may edit the component, then forwards the request with a signature that proves it.
import crypto from 'node:crypto';

const MAX_AGE_MS = 60 * 1000;

export function sign(secret, timestamp, userId, role) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${userId}\n${role}`).digest('hex');
}

/** Headers the course tool adds to every request it forwards. */
export function signedHeaders(secret, user, role = 'author', now = Date.now()) {
  const timestamp = String(now);
  return {
    'x-adapt-ts': timestamp,
    'x-adapt-user': encodeURIComponent(user.id),
    'x-adapt-name': encodeURIComponent(user.name || ''),
    'x-adapt-role': role,
    'x-adapt-sig': sign(secret, timestamp, user.id, role)
  };
}

/** The user described by a request's headers, or null if the signature is missing, wrong or too old. */
export function verifyHeaders(secret, headers, now = Date.now()) {
  if (!secret) return null;
  const timestamp = headers['x-adapt-ts'];
  const signature = headers['x-adapt-sig'];
  const role = headers['x-adapt-role'];
  if (!timestamp || !signature || !headers['x-adapt-user'] || !['author', 'system'].includes(role)) return null;
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > MAX_AGE_MS) return null;
  let id;
  let name;
  try {
    id = decodeURIComponent(headers['x-adapt-user']);
    name = decodeURIComponent(headers['x-adapt-name'] || '');
  } catch (error) {
    return null;
  }
  const expected = Buffer.from(sign(secret, timestamp, id, role));
  const given = Buffer.from(String(signature));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return { id, name: name || id, email: '', type: 'local', role };
}
