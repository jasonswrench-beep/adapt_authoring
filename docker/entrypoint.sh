#!/bin/sh
# First run: copy source into /app (a persistent volume), install the authoring tool,
# the framework and the plugin bundle. Later runs: just start the server.
set -e
cd /app

if [ ! -f /app/.adapt-initialised ]; then
  echo ">> First run: installing authoring tool into /app (this takes several minutes)"
  rsync -a --exclude node_modules /opt/adapt-src/ /app/
  npm install --omit=dev --unsafe-perm --loglevel error
  # optional: dependencies of the accessibility checker's full (rendered) check; the quick check works without them
  (cd scripts/a11y-check && npm install --omit=dev --no-audit --no-fund --loglevel error) \
    || echo "!! Full accessibility check unavailable (npm install failed in scripts/a11y-check)"

  : "${ADAPT_SU_EMAIL:?Set ADAPT_SU_EMAIL in .env}"
  : "${ADAPT_SU_PASSWORD:?Set ADAPT_SU_PASSWORD in .env}"

  # Every installer prompt is answered here so the first run never blocks on input.
  node install --install true \
    --serverPort 5000 --serverName "${ADAPT_SERVER_NAME:-localhost}" --dataRoot data \
    --authoringToolRepository https://github.com/adaptlearning/adapt_authoring.git \
    --frameworkRepository https://github.com/adaptlearning/adapt_framework.git \
    --frameworkRevision "${ADAPT_FRAMEWORK_REVISION:-tags/v5.56.3}" \
    --dbName adapt-tenant-master --useConnectionUri false \
    --dbHost mongo --dbPort 27017 --dbUser "" --dbPass "" --dbAuthSource "" \
    --useSmtp false \
    --masterTenantName master --masterTenantDisplayName "${ADAPT_TENANT_NAME:-Course Authoring}" \
    --suEmail "$ADAPT_SU_EMAIL" --suPassword "$ADAPT_SU_PASSWORD" --suRetypePassword "$ADAPT_SU_PASSWORD"

  echo ">> Installing plugin bundle (conf/plugin-bundle.json)"
  node scripts/install-plugin-bundle.js || echo "!! Some plugins failed; re-run: docker compose exec adapt node scripts/install-plugin-bundle.js"

  echo ">> Installing H5P activity libraries (a few minutes)"
  node h5p-library/install.js /app/data/h5p-libraries /app/temp/h5p-library-work \
    || echo "!! Some H5P libraries could not be installed; re-run: docker compose exec adapt node h5p-library/install.js /app/data/h5p-libraries"
  rm -rf /app/temp/h5p-library-work

  grunt build:prod
  touch /app/.adapt-initialised
fi

exec node server
