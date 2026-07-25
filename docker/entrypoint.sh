#!/bin/sh
set -eu

cd /app

case "${1:-}" in
  mail)
    exec pnpm --dir apps/mail dev --host 0.0.0.0 --port 3000
    ;;
  server)
    exec pnpm --dir apps/server exec wrangler dev \
      --ip 0.0.0.0 \
      --port 8787 \
      --show-interactive-dev-session=false \
      --experimental-vectorize-bind-to-prod \
      --env "${ZERO_WRANGLER_ENV:-local}" \
      --env-file /app/.env \
      --var "DATABASE_URL:${DATABASE_URL}" \
      --var "REDIS_URL:${REDIS_URL}" \
      --var "REDIS_TOKEN:${REDIS_TOKEN}"
    ;;
  *)
    echo "Unknown Zero development service: ${1:-<empty>}" >&2
    exit 64
    ;;
esac
