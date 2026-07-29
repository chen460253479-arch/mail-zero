# Server Immutable Worker Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Zero Server once during Docker image construction and run an immutable Worker Bundle without host source mounts or runtime TypeScript bundling.

**Architecture:** A dedicated multi-stage Server image uses Wrangler dry-run to produce `/app/server-dist/worker.js`. The runtime image contains only that Bundle, Wrangler runtime dependencies, its configuration and a small environment-file writer; it starts the Bundle through `wrangler dev --no-bundle` while preserving all current Worker Bindings. Protocol Worker remains on the existing development image until its own later migration.

**Tech Stack:** Docker Compose, Node.js 22, pnpm 10.15, Wrangler/Miniflare, POSIX shell, TypeScript 5.8, Vitest 3.

## Global Constraints

- Do not replace any Cloudflare Binding in this phase.
- Do not change mail synchronization, outbound delivery, authentication, Webhook, tRPC or database behavior.
- Do not bake `.env`, Nango credentials, database credentials, Redis credentials or encryption keys into an image.
- Do not mount repository source or Workspace `node_modules` into the Server runtime.
- Preserve the Wrangler local-state named volume.
- Keep Protocol Worker on `docker/Dockerfile` and the persisted dependency volumes.
- Keep `pnpm docker:deploy` as the full-stack deployment command.
- Do not install or update repository dependencies or modify `pnpm-lock.yaml`.
- Preserve unrelated untracked `node-compile-cache/` and `update-check/`.
- The working tree contains earlier in-scope uncommitted work; do not create implementation commits or push until the user explicitly requests it.

---

### Task 1: Define the Immutable Server Docker Contract

**Files:**

- Create: `apps/server/tests/architecture/docker-server-immutable-runtime.test.ts`
- Modify: `apps/server/tests/architecture/docker-mail-static-runtime.test.ts`
- Modify: `apps/server/tests/architecture/docker-development-stack.test.ts`
- Modify: `apps/server/tests/architecture/docker-workspace-dependencies.test.ts`

**Interfaces:**

- Consumes: resolved `docker compose config --format json`.
- Produces: an executable architecture contract for the Server image, Compose mounts, deployment bootstrap and runtime entrypoint.

- [ ] **Step 1: Add the failing immutable-runtime architecture test**

Create `docker-server-immutable-runtime.test.ts` using the same repository-root and Compose parsing approach as `docker-mail-static-runtime.test.ts`. Assert:

```ts
expect(server.image).toBe('zero-server-runtime');
expect(server.build?.dockerfile).toBe('docker/server/Dockerfile');
expect(server.command ?? null).toBeNull();
expect(volumeTargets).toEqual(['/var/lib/zero/wrangler']);
expect(server.environment).not.toHaveProperty('CHOKIDAR_USEPOLLING');
expect(server.environment).not.toHaveProperty('CHOKIDAR_INTERVAL');
expect(server.environment).not.toHaveProperty('ZERO_DOCKER_DEV');
```

Read the proposed runtime files and assert:

```ts
expect(serverDockerfile).toContain('wrangler deploy --dry-run');
expect(serverDockerfile).toContain('--outfile /app/server-dist/worker.js');
expect(serverDockerfile).toContain('FROM node:22-bookworm-slim AS runtime');
expect(serverDockerfile).not.toMatch(/FROM node:22-bookworm-slim AS runtime[\s\S]*COPY \. \./);
expect(serverEntrypoint).toContain('--no-bundle');
expect(serverEntrypoint).toContain('/app/server-dist/worker.js');
expect(serverEntrypoint).toContain('--persist-to /var/lib/zero/wrangler');
expect(serverEntrypoint).not.toContain('pnpm install');
expect(serverEntrypoint).not.toContain('wrangler deploy');
expect(serverEntrypoint).not.toContain('--var');
```

Assert `.dockerignore` excludes `.env` and `**/.dev.vars`.

- [ ] **Step 2: Change existing Docker expectations**

In `docker-mail-static-runtime.test.ts`, replace the test that expects Server development mounts with immutable Server expectations.

In `docker-development-stack.test.ts`:

- change dependency initialization from `server install-dependencies` to `protocol-worker install-dependencies`;
- expect `docker/server/Dockerfile` for Server;
- expect `docker/Dockerfile` to be built explicitly by Protocol Worker;
- keep development source mounts only for Protocol Worker;
- replace README expectations about Server hot reload with rebuild-only wording.

In `docker-workspace-dependencies.test.ts`, expect the explicit bootstrap instruction to name `protocol-worker`.

- [ ] **Step 3: Run the architecture tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/docker-server-immutable-runtime.test.ts tests/architecture/docker-mail-static-runtime.test.ts tests/architecture/docker-development-stack.test.ts tests/architecture/docker-workspace-dependencies.test.ts --reporter=dot
```

Expected: FAIL because `docker/server/Dockerfile` and its runtime files do not exist and Server still inherits the development Compose anchor.

### Task 2: Materialize Worker Variables Without Exposing Secrets

**Files:**

- Create: `docker/server/write-runtime-env.mjs`
- Create: `apps/server/tests/unit/docker/server-runtime-env.test.ts`

**Interfaces:**

- Consumes: whitelisted string values from `process.env` and optional `ZERO_RUNTIME_ENV_PATH`.
- Produces: a mode-`0600` dotenv file consumed by Wrangler `--env-file`; produces no stdout or secret-bearing command arguments.

- [ ] **Step 1: Write the failing runtime-environment test**

The test must spawn the script with an isolated temporary path:

```ts
const result = spawnSync(process.execPath, [scriptPath], {
  encoding: 'utf8',
  env: {
    ...process.env,
    ZERO_RUNTIME_ENV_PATH: outputPath,
    DATABASE_URL: 'postgresql://user:p#ss@db:5432/zero',
    NANGO_SECRET_KEY: 'secret "quoted" value',
    UNRELATED_HOST_SECRET: 'must-not-be-written',
  },
});

expect(result.status).toBe(0);
expect(result.stdout).toBe('');
expect(result.stderr).toBe('');
expect(readFileSync(outputPath, 'utf8')).toContain(
  `DATABASE_URL=${JSON.stringify('postgresql://user:p#ss@db:5432/zero')}`,
);
expect(readFileSync(outputPath, 'utf8')).toContain(
  `NANGO_SECRET_KEY=${JSON.stringify('secret "quoted" value')}`,
);
expect(readFileSync(outputPath, 'utf8')).not.toContain('UNRELATED_HOST_SECRET');
```

On non-Windows platforms, assert `(statSync(outputPath).mode & 0o777) === 0o600`.

- [ ] **Step 2: Run the environment test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/docker/server-runtime-env.test.ts --reporter=dot
```

Expected: FAIL because `docker/server/write-runtime-env.mjs` does not exist.

- [ ] **Step 3: Implement the environment writer**

Create the script with an explicit whitelist matching the string fields of `ZeroEnv`:

```js
const runtimeVariableNames = [
  'NODE_ENV',
  'JWT_SECRET',
  'BASE_URL',
  'VITE_PUBLIC_APP_URL',
  'VITE_PUBLIC_BACKEND_URL',
  'DATABASE_URL',
  'CREDENTIAL_ENCRYPTION_KEY',
  'NANGO_BASE_URL',
  'NANGO_SECRET_KEY',
  'NANGO_GMAIL_INTEGRATION_KEY',
  'NANGO_OUTLOOK_INTEGRATION_KEY',
  'NANGO_ZOHO_MAIL_INTEGRATION_KEY',
  'NANGO_IMAP_SMTP_INTEGRATION_KEY',
  'MAIL_PROTOCOL_WORKER_URL',
  'MAIL_PROTOCOL_WORKER_SECRET',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'RESEND_API_KEY',
  'COOKIE_DOMAIN',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'ZERO_ADMIN_AUTO_PROVISION',
  'ZERO_ADMIN_NAME',
  'ZERO_ADMIN_EMAIL',
  'ZERO_ADMIN_PASSWORD',
  'ZERO_ADMIN_BOOTSTRAP_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'REDIS_URL',
  'REDIS_TOKEN',
  'EARLY_ACCESS_ENABLED',
  'DEV_PROXY',
  'MEET_AUTH_HEADER',
  'MEET_API_URL',
  'ENABLE_MEET',
];
```

For each defined value, write `${name}=${JSON.stringify(value)}`. Create the parent directory, write atomically through a temporary file, set mode `0600`, rename it to `ZERO_RUNTIME_ENV_PATH ?? '/run/zero/server.env'`, and emit no output.

- [ ] **Step 4: Run the environment test and verify GREEN**

Run the Task 2 test again.

Expected: PASS.

### Task 3: Build and Run the Immutable Server Image

**Files:**

- Create: `docker/server/Dockerfile`
- Create: `docker/server/entrypoint.sh`
- Modify: `compose.yaml`

**Interfaces:**

- Consumes: repository source only in the Docker Builder; runtime environment from Compose; Worker Binding configuration from `apps/server/wrangler.jsonc`.
- Produces: image `zero-server-runtime` listening on port 8787 and persisting Wrangler state under `/var/lib/zero/wrangler`.

- [ ] **Step 1: Add the multi-stage Server Dockerfile**

Builder requirements:

```dockerfile
FROM node:22-bookworm-slim AS builder
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates libc++1 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.15.0
WORKDIR /app
ENV CI=true HUSKY=0
COPY . .
RUN pnpm install --frozen-lockfile
RUN mkdir -p /app/server-dist \
    && pnpm --dir apps/server exec wrangler deploy \
      --dry-run \
      --env local \
      --outfile /app/server-dist/worker.js
```

Runtime requirements:

```dockerfile
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates libc++1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production ZERO_RUNTIME_ENV_PATH=/run/zero/server.env
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/server/node_modules /app/apps/server/node_modules
COPY --from=builder /app/apps/server/wrangler.jsonc /app/apps/server/wrangler.jsonc
COPY --from=builder /app/server-dist /app/server-dist
COPY docker/server/write-runtime-env.mjs /app/runtime/write-runtime-env.mjs
COPY docker/server/entrypoint.sh /usr/local/bin/zero-server-entrypoint
RUN chmod +x /usr/local/bin/zero-server-entrypoint
EXPOSE 8787
ENTRYPOINT ["zero-server-entrypoint"]
```

- [ ] **Step 2: Add the Runtime entrypoint**

The POSIX shell entrypoint must:

```sh
#!/bin/sh
set -eu

bundle_path=/app/server-dist/worker.js
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
```

- [ ] **Step 3: Split Server from the development Compose anchor**

Change `server` to:

```yaml
server:
  image: zero-server-runtime
  build:
    context: .
    dockerfile: docker/server/Dockerfile
  env_file:
    - .env
  environment:
    ZERO_WRANGLER_ENV: ${ZERO_WRANGLER_ENV:-local}
    DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@db:5432/${POSTGRES_DB:-zerodotemail}
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@db:5432/${POSTGRES_DB:-zerodotemail}
    WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@db:5432/${POSTGRES_DB:-zerodotemail}
    REDIS_URL: http://upstash-proxy:80
    REDIS_TOKEN: ${REDIS_TOKEN:-upstash-local-token}
    MAIL_PROTOCOL_WORKER_URL: http://protocol-worker:8790
    MAIL_PROTOCOL_WORKER_SECRET: ${MAIL_PROTOCOL_WORKER_SECRET:-zero-local-mail-protocol-worker-secret-change-me}
    NANGO_GMAIL_INTEGRATION_KEY: ${NANGO_GMAIL_INTEGRATION_KEY:-gmail}
    NANGO_OUTLOOK_INTEGRATION_KEY: ${NANGO_OUTLOOK_INTEGRATION_KEY:-outlook}
    NANGO_ZOHO_MAIL_INTEGRATION_KEY: ${NANGO_ZOHO_MAIL_INTEGRATION_KEY:-zoho-mail}
    NANGO_IMAP_SMTP_INTEGRATION_KEY: ${NANGO_IMAP_SMTP_INTEGRATION_KEY:-imap-smtp}
  volumes:
    - zero-wrangler-state:/var/lib/zero/wrangler
```

Keep the existing dependency, port and health-check declarations. Do not set `command`.

Add an explicit `build` section using `docker/Dockerfile` to `protocol-worker`, because Server no longer builds the shared `zero-development` image.

- [ ] **Step 4: Run architecture tests and Compose parsing**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/docker-server-immutable-runtime.test.ts tests/architecture/docker-mail-static-runtime.test.ts tests/architecture/docker-development-stack.test.ts tests/architecture/docker-workspace-dependencies.test.ts --reporter=dot
docker compose config --format json
```

Expected: all tests PASS and Compose returns valid JSON.

### Task 4: Preserve Deployment and Operator Documentation

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Modify: `docker/entrypoint.sh`

**Interfaces:**

- Consumes: the existing `pnpm docker:deploy` operator workflow.
- Produces: dependency bootstrap through Protocol Worker and accurate rebuild-only Server documentation.

- [ ] **Step 1: Change the dependency bootstrap target**

Change:

```json
"docker:deploy": "docker compose build && docker compose run --rm --no-deps server install-dependencies && docker compose up --detach --wait --wait-timeout 180 && docker compose ps"
```

to:

```json
"docker:deploy": "docker compose build && docker compose run --rm --no-deps protocol-worker install-dependencies && docker compose up --detach --wait --wait-timeout 180 && docker compose ps"
```

Update the error message in `docker/entrypoint.sh` to:

```text
docker compose run --rm --no-deps protocol-worker install-dependencies
```

- [ ] **Step 2: Update README operational guidance**

Replace the Server hot-reload statement with:

```text
Server runs from a prebuilt immutable Worker Bundle. Source changes require rebuilding the Server image.
```

Document:

```powershell
docker compose up --detach --build --no-deps server
```

State that Wrangler remains a temporary compatibility runtime and Cloudflare Bindings are unchanged in this phase.

- [ ] **Step 3: Run Docker architecture tests**

Run the four Task 1 architecture tests again.

Expected: PASS.

### Task 5: Full Verification and Runtime Smoke Test

**Files:**

- Modify only files already listed if verification reveals an in-scope defect.

**Interfaces:**

- Consumes: completed immutable Server image and Compose definition.
- Produces: static, test and runtime evidence for handoff.

- [ ] **Step 1: Run static and unit verification**

Run:

```powershell
pnpm --filter @zero/server exec tsc --noEmit --pretty false
pnpm --filter @zero/server exec vitest run tests/unit tests/architecture --exclude tests/unit/modules/mail-outbound/application/enqueue-submission.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 2: Run changed-file lint and formatting**

Run ESLint only for changed TypeScript/TSX files and Prettier for supported changed files, excluding generated `.snap` files.

Expected: no errors in changed files and Prettier PASS.

- [ ] **Step 3: Validate Compose and build the Server image**

Run:

```powershell
docker compose config --quiet
docker compose build server
```

Expected: both commands exit 0.

- [ ] **Step 4: Inspect image contents before starting it**

Run:

```powershell
docker run --rm --entrypoint sh zero-server-runtime -c "test -f /app/server-dist/worker.js && test ! -d /app/apps/server/src"
```

Expected: exit 0.

- [ ] **Step 5: Replace only Server and verify health**

With its dependencies already running:

```powershell
docker compose up --detach --no-deps server
docker compose ps server
docker compose logs --since 2m server
```

Expected:

- Server becomes healthy;
- logs contain no runtime Bundle build;
- Nango startup validation retains its existing success/unavailable behavior;
- the container has no `/app` host-source mount.

- [ ] **Step 6: Verify the runtime boundary**

Inspect mounts:

```powershell
docker inspect zerodotemail-server --format '{{json .Mounts}}'
```

Expected: the only Server mount targets `/var/lib/zero/wrangler`.

Run:

```powershell
docker stats --no-stream zerodotemail-server
```

Record memory usage as evidence. Do not impose a fixed pass/fail threshold.

- [ ] **Step 7: Final hygiene scan**

Confirm:

- `pnpm-lock.yaml` and package dependencies did not change;
- Server production code has no source-volume or Chokidar configuration;
- `.env` is absent from the image and Docker build context;
- Protocol Worker still has its dependency volumes and explicit bootstrap command;
- `node-compile-cache/` and `update-check/` remain untracked and untouched.
