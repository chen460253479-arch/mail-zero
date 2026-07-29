FROM node:22-bookworm-slim AS builder

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.15.0

WORKDIR /app

ENV CI=true \
    HUSKY=0

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @zero/server build
RUN pnpm --filter @zero/server --prod deploy --legacy /app/server-runtime

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node /var/lib/zero/mail-blobs

WORKDIR /app

ENV NODE_ENV=production \
    MAIL_BLOB_ROOT=/var/lib/zero/mail-blobs

COPY --from=builder --chown=node:node /app/server-runtime/ /app/
COPY docker/server/entrypoint.sh /usr/local/bin/zero-server-entrypoint

RUN chmod +x /usr/local/bin/zero-server-entrypoint

USER node

EXPOSE 8787

ENTRYPOINT ["zero-server-entrypoint"]
