#!/bin/sh
set -eu

cd /app

dependency_fingerprint="$(
  sha256sum \
    pnpm-lock.yaml \
    pnpm-workspace.yaml \
    package.json \
    apps/*/package.json \
    packages/*/package.json \
    scripts/package.json |
    sha256sum |
    cut -d ' ' -f 1
)"
dependency_directories="
/app/node_modules
/app/apps/mail/node_modules
/app/apps/server/node_modules
/app/packages/cli/node_modules
/app/packages/eslint-config/node_modules
/app/packages/mail-core/node_modules
/app/packages/testing/node_modules
/app/packages/tsconfig/node_modules
"
dependencies_current=true

for dependency_directory in ${dependency_directories}; do
  dependency_stamp="${dependency_directory}/.zero-dependencies-fingerprint"
  installed_fingerprint="$(cat "${dependency_stamp}" 2>/dev/null || true)"

  if [ "${installed_fingerprint}" != "${dependency_fingerprint}" ]; then
    dependencies_current=false
    break
  fi
done

write_dependency_stamps() {
  for dependency_directory in ${dependency_directories}; do
    dependency_stamp="${dependency_directory}/.zero-dependencies-fingerprint"
    mkdir -p "${dependency_directory}"
    printf '%s\n' "${dependency_fingerprint}" >"${dependency_stamp}"
  done
}

case "${1:-}" in
  install-dependencies)
    pnpm install --frozen-lockfile
    write_dependency_stamps
    exit 0
    ;;
esac

if [ "${dependencies_current}" = false ]; then
  echo "Docker workspace dependencies are not initialized for the current lockfile." >&2
  echo "Run this command explicitly, then start the services again:" >&2
  echo "  docker compose run --rm server install-dependencies" >&2
  exit 78
fi

case "${1:-}" in
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
