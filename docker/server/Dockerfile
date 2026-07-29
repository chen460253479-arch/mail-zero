FROM node:22-bookworm-slim AS builder

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates libc++1 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.15.0

WORKDIR /app

ENV CI=true \
    HUSKY=0

COPY . .

RUN pnpm install --frozen-lockfile
RUN mkdir -p /app/server-dist \
    && pnpm --dir apps/server exec wrangler deploy --dry-run \
      --env local \
      --outdir /app/server-dist

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates libc++1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    ZERO_RUNTIME_ENV_PATH=/run/zero/server.env

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/server/node_modules /app/apps/server/node_modules
COPY --from=builder /app/apps/server/wrangler.jsonc /app/apps/server/wrangler.jsonc
COPY --from=builder /app/server-dist /app/server-dist
COPY docker/server/write-runtime-env.mjs /app/runtime/write-runtime-env.mjs
COPY docker/server/entrypoint.sh /usr/local/bin/zero-server-entrypoint

RUN chmod +x /usr/local/bin/zero-server-entrypoint

EXPOSE 8787

ENTRYPOINT ["zero-server-entrypoint"]
