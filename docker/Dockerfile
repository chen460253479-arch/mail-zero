FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates libc++1 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.15.0

WORKDIR /app

ENV CI=true \
    HUSKY=0 \
    NODE_ENV=development

COPY . .

RUN pnpm install --frozen-lockfile

COPY docker/entrypoint.sh /usr/local/bin/zero-dev-entrypoint
RUN chmod +x /usr/local/bin/zero-dev-entrypoint

EXPOSE 3000 8787

ENTRYPOINT ["zero-dev-entrypoint"]
