FROM node:22-bookworm-slim

# git: the installer clones the Adapt framework and plugins; build-essential/python3: native modules (bcrypt)
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates build-essential python3 rsync \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g grunt-cli

# Pristine copy of the source; the entrypoint syncs it into the persistent /app volume on first run.
COPY . /opt/adapt-src
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /app
EXPOSE 5000
ENTRYPOINT ["entrypoint.sh"]
