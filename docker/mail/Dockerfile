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

ARG VITE_PUBLIC_APP_URL=http://localhost:3000
ARG VITE_PUBLIC_BACKEND_URL=http://localhost:8787
ARG VITE_PUBLIC_IMAGE_PROXY=
ARG VITE_PUBLIC_IMAGE_API_URL=

ENV VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL} \
    VITE_PUBLIC_BACKEND_URL=${VITE_PUBLIC_BACKEND_URL} \
    VITE_PUBLIC_IMAGE_PROXY=${VITE_PUBLIC_IMAGE_PROXY} \
    VITE_PUBLIC_IMAGE_API_URL=${VITE_PUBLIC_IMAGE_API_URL} \
    NODE_ENV=production

RUN pnpm --filter @zero/mail build

FROM nginx:1.28-alpine AS runtime

COPY docker/mail/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/mail/build/client /usr/share/nginx/html

EXPOSE 3000
