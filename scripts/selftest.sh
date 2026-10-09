#!/bin/sh
# One command for the whole server-side smoke test. Run on the server from the repository folder:  sh scripts/selftest.sh
# The script is fed into the running container from this checkout, so only "git pull" is needed first (no rebuild).
# Takes a few minutes the first time because it builds a throwaway course (deleted at the end).
cd "$(dirname "$0")/.." || exit 1
docker compose exec -T adapt node - < scripts/selftest.js
