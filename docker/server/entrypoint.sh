#!/bin/sh
set -eu

if [ ! -f /app/dist/main.js ]; then
  echo "Zero Server Node artifact is missing." >&2
  exit 78
fi

exec node /app/dist/main.js
