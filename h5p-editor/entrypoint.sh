#!/bin/sh
# Prepares the editor's data folder (first start: a few minutes; later starts: seconds) and runs the service.
set -e
cd /srv/h5p/h5p-editor
DATA="${H5P_EDITOR_DATA:-/data}"
mkdir -p "$DATA" /shared

# The secret that proves a request came from the course tool: made once, shared through the /shared volume.
if [ -z "$H5P_EDITOR_SECRET" ]; then
  if [ ! -s /shared/h5p-editor-secret ]; then
    (umask 077; node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > /shared/h5p-editor-secret)
  fi
  H5P_EDITOR_SECRET="$(cat /shared/h5p-editor-secret)"
  export H5P_EDITOR_SECRET
fi

echo ">> H5P browser scripts"
./setup-core.sh "$DATA" || echo "!! Could not fetch the H5P scripts; the editor will not work until this succeeds (restart the service to retry)"
echo ">> H5P libraries for the editor"
node ../h5p-library/install.js --editor "$DATA/libraries" "$DATA/work" ../h5p-library/lock.json \
  || echo "!! Some H5P libraries could not be installed (see above); activities that need them cannot be edited"
rm -rf "$DATA/work"

exec node server.mjs
