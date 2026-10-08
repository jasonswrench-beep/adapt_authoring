FROM node:22-bookworm-slim

# git: the installer clones the Adapt framework and plugins; build-essential/python3: native modules (bcrypt)
# chromium: used by the editor's "Check accessibility" full check (axe-core renders each page in a browser)
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates build-essential python3 rsync chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g grunt-cli

# Pristine copy of the source; the entrypoint syncs it into the persistent /app volume on first run.
COPY . /opt/adapt-src
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app
EXPOSE 5000
ENTRYPOINT ["entrypoint.sh"]
