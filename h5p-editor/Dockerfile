FROM node:22-bookworm-slim

# git: fetches the H5P browser scripts and the H5P libraries; build-essential/python3: some libraries are built on install
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates build-essential python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/h5p
COPY h5p-editor/package.json ./h5p-editor/package.json
RUN cd h5p-editor && npm install --omit=dev --no-audit --no-fund --loglevel=error
COPY h5p-editor ./h5p-editor
COPY h5p-library/install.js h5p-library/lock.json ./h5p-library/
COPY h5p-library/patches ./h5p-library/patches
RUN chmod +x h5p-editor/entrypoint.sh h5p-editor/setup-core.sh

ENV H5P_EDITOR_DATA=/data PORT=8080
EXPOSE 8080
ENTRYPOINT ["/srv/h5p/h5p-editor/entrypoint.sh"]
