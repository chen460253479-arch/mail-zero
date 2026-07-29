#!/bin/sh
set -eu

bundle_path=/app/server-dist/main.js
runtime_env_path="${ZERO_RUNTIME_ENV_PATH:-/run/zero/server.env}"
wrangler_environment="${ZERO_WRANGLER_ENV:-local}"

if [ ! -f "${bundle_path}" ]; then
  echo "Zero Server Worker Bundle is missing." >&2
  exit 78
fi

node /app/runtime/write-runtime-env.mjs

exec /app/apps/server/node_modules/.bin/wrangler dev "${bundle_path}" \
  --no-bundle \
  --config /app/apps/server/wrangler.jsonc \
  --env "${wrangler_environment}" \
  --env-file "${runtime_env_path}" \
  --ip 0.0.0.0 \
  --port 8787 \
  --persist-to /var/lib/zero/wrangler \
  --show-interactive-dev-session=false \
  --experimental-vectorize-bind-to-prod
