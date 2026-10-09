#!/bin/sh
# Brings an already-running server up to date with the source baked into the current image.
# The source is only copied into the persistent /app volume on first start, so pulling new code and rebuilding the
# image is not enough by itself: run this once afterwards (see "Updating" in docs/CLASSROOM-SETUP.md).
# Settings (conf/config.json), course data, users and uploaded files are kept.
set -e
cd /app

if [ ! -f /app/.adapt-initialised ]; then
  echo "Nothing to update: this server has not finished its first-run setup. Start it with 'docker compose up -d' first."
  exit 1
fi

echo ">> Copying new source into /app (settings and data are kept)"
rsync -a --exclude node_modules --exclude /conf/config.json --exclude /conf/migrate.json --exclude /data --exclude /temp /opt/adapt-src/ /app/

echo ">> Updating dependencies"
npm install --omit=dev --unsafe-perm --loglevel error
(cd scripts/a11y-check && npm install --omit=dev --no-audit --no-fund --loglevel error) \
  || echo "!! Full accessibility check dependencies could not be installed"

echo ">> Installing plugin bundle (new plugins are added; unchanged ones are skipped)"
node scripts/install-plugin-bundle.js || echo "!! Some plugins failed (see above). The server still works with the ones that installed."

echo ">> Installing H5P activity libraries (first run takes a few minutes; later runs only fetch what changed)"
node h5p-library/install.js /app/data/h5p-libraries /app/temp/h5p-library-work \
  || echo "!! Some H5P libraries could not be installed (see above). The activity gallery will say so; everything else works."
rm -rf /app/temp/h5p-library-work

echo ">> Rebuilding the editor"
grunt build:prod

echo ">> Update finished. Start the server again with: docker compose up -d"
