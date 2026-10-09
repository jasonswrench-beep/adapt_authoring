#!/bin/sh
# Prints everything needed to diagnose the server in one go, so it can be pasted back in a single message.
# Run on the server from the repository folder:   sh scripts/diagnose.sh
# It never prints passwords: the .env file is not shown.
cd "$(dirname "$0")/.." || exit 1
echo "=== version ==="; git log --oneline -1
echo "=== containers ==="; docker compose ps
echo "=== last 40 log lines ==="; docker compose logs --tail=40 adapt 2>&1 | cut -c1-220
echo "=== installed plugins (count) ==="; docker compose exec -T adapt sh -c 'ls /app/temp/*/adapt_framework/src/components /app/temp/*/adapt_framework/src/extensions 2>/dev/null | grep -c adapt' 2>&1
echo "=== accessibility checker on the newest course build ==="
docker compose exec -T adapt sh -c 'B=$(ls -dt /app/temp/*/adapt_framework/courses/*/*/build 2>/dev/null | head -1); echo "folder: $B"; [ -n "$B" ] && cd /app/scripts/a11y-check && node a11y-check.js "$B" --fail-on never 2>&1 | cut -c1-400' 2>&1
echo "=== disk and memory ==="; df -h / | tail -1; free -m | sed -n 2p
echo "=== end ==="
