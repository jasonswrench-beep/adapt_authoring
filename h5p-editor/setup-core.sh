#!/bin/sh
# Fetches the H5P browser-side core and editor scripts (GPL-3.0, from the H5P project) at pinned commits into
# <data>/core and <data>/editor. Used by the editor service on first start; safe to run again.
set -e
DATA="${1:-./data}"
CORE_COMMIT=2aeb0b83fa603e331381b3a6b8bf42c3773ba140
EDITOR_COMMIT=ab2daa18bd61b19e7f8729e22eec88f3b637a868
fetch() { # repo commit dest
  if [ -f "$3/.commit" ] && [ "$(cat "$3/.commit")" = "$2" ]; then return 0; fi
  rm -rf "$3.tmp" "$3"
  mkdir -p "$3.tmp"
  git -C "$3.tmp" init -q
  git -C "$3.tmp" fetch -q --depth 1 "https://github.com/$1" "$2"
  git -C "$3.tmp" checkout -q FETCH_HEAD
  rm -rf "$3.tmp/.git"
  echo "$2" > "$3.tmp/.commit"
  mv "$3.tmp" "$3"
}
fetch h5p/h5p-php-library "$CORE_COMMIT" "$DATA/core"
fetch h5p/h5p-editor-php-library "$EDITOR_COMMIT" "$DATA/editor"
