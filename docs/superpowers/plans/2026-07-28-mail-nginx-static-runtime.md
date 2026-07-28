# Mail Nginx Static Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Mail frontend once inside a dedicated Docker image and serve only its static client artifact with Nginx.

**Architecture:** A Node.js builder stage installs the pnpm workspace and runs the existing SPA build; an Nginx runtime stage receives only `apps/mail/build/client`. Docker Compose stops applying the Server development anchor, source mount, secrets, polling, and Vite command to Mail while leaving Server unchanged.

**Tech Stack:** Docker Compose, multi-stage Docker builds, Node.js 22, pnpm 10.15.0, React Router 7/Vite, Nginx Alpine, Vitest

## Global Constraints

- Keep the existing single `compose.yaml`; development/runtime profile separation is out of scope.
- Convert only Mail to a static runtime; keep Server on its current Wrangler development runtime.
- Compile only public `VITE_PUBLIC_*` values into Mail and never copy `.env` or Server credentials into the runtime image.
- Do not supply `VITE_INTERNAL_BACKEND_URL` to the static Mail build.
- Do not mount repository source or workspace `node_modules` into Mail.
- Do not build inside the running Nginx container.
- Preserve `/mail/*`, `/settings/*`, and authentication deep links with an SPA fallback.
- Leave implementation changes uncommitted and unpushed until the user explicitly requests otherwise.

---

### Task 1: Protect the static Mail Compose contract

**Files:**

- Create: `apps/server/tests/architecture/docker-mail-static-runtime.test.ts`

**Interfaces:**

- Consumes: `docker compose config --format json` for the repository Compose project.
- Produces: a regression boundary proving Mail is a static isolated service and Server remains the development service.

- [x] **Step 1: Write the failing Compose behavior test**

Create `apps/server/tests/architecture/docker-mail-static-runtime.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type ComposeService = {
  build?: { args?: Record<string, string>; context?: string; dockerfile?: string };
  command?: string[] | null;
  environment?: Record<string, string>;
  healthcheck?: { test?: string[] };
  image?: string;
  volumes?: unknown[];
};

type ComposeConfig = {
  services: Record<string, ComposeService>;
};

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(architectureRoot, '../../../..');

const result = spawnSync(
  'docker',
  ['compose', '--project-directory', repoRoot, 'config', '--format', 'json'],
  { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' },
);

if (result.status !== 0) {
  throw new Error(`docker compose config failed: ${result.stderr}`);
}

const compose = JSON.parse(result.stdout) as ComposeConfig;

describe('Docker Mail static runtime', () => {
  it('builds Mail as an isolated static image', () => {
    const mail = compose.services.mail;

    expect(mail.image).toBe('zero-mail-runtime');
    expect(mail.build?.dockerfile).toBe('docker/mail/Dockerfile');
    expect(mail.command ?? null).toBeNull();
    expect(mail.volumes ?? []).toHaveLength(0);
    expect(mail.environment ?? {}).toEqual({});
    expect(mail.healthcheck?.test?.join(' ')).toContain('http://127.0.0.1:3000/health');
    expect(mail.healthcheck?.test?.join(' ')).not.toContain('/@vite/client');
  });

  it('passes only public browser configuration into the Mail build', () => {
    const buildArgs = compose.services.mail.build?.args ?? {};

    expect(Object.keys(buildArgs).sort()).toEqual([
      'VITE_PUBLIC_APP_URL',
      'VITE_PUBLIC_BACKEND_URL',
      'VITE_PUBLIC_IMAGE_API_URL',
      'VITE_PUBLIC_IMAGE_PROXY',
    ]);
    expect(buildArgs).not.toHaveProperty('VITE_INTERNAL_BACKEND_URL');
    expect(buildArgs).not.toHaveProperty('DATABASE_URL');
    expect(buildArgs).not.toHaveProperty('REDIS_TOKEN');
  });

  it('keeps Server on the persisted development runtime', () => {
    const server = compose.services.server;
    const volumeTargets = (server.volumes ?? []).map((volume) =>
      typeof volume === 'object' && volume !== null && 'target' in volume
        ? String(volume.target)
        : '',
    );

    expect(server.image).toBe('zero-development');
    expect(server.command).toEqual(['server']);
    expect(volumeTargets).toContain('/app');
    expect(volumeTargets).toContain('/app/node_modules');
    expect(server.environment).toHaveProperty('CHOKIDAR_USEPOLLING', 'true');
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/docker-mail-static-runtime.test.ts
```

Expected: the Mail tests fail because it currently uses `zero-development`, command `mail`, ten
development volumes, Server secrets, Chokidar polling, and `/@vite/client`.

---

### Task 2: Build and serve Mail with Nginx

**Files:**

- Create: `docker/mail/Dockerfile`
- Create: `docker/mail/nginx.conf`
- Modify: `compose.yaml`
- Modify: `docker/entrypoint.sh`
- Modify: `apps/mail/vite.config.ts`
- Create: `apps/mail/modules/config/vite-config.test.ts`
- Modify: `apps/server/tests/architecture/docker-development-stack.test.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: public Compose interpolation values `VITE_PUBLIC_APP_URL`,
  `VITE_PUBLIC_BACKEND_URL`, `VITE_PUBLIC_IMAGE_PROXY`, and
  `VITE_PUBLIC_IMAGE_API_URL`.
- Produces: image `zero-mail-runtime`, port `3000`, `/health`, immutable `/assets/`, and SPA route
  fallback.

- [x] **Step 1: Add the multi-stage Mail image**

Create `docker/mail/Dockerfile`:

```dockerfile
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
```

- [x] **Step 2: Add the static runtime configuration**

Create `docker/mail/nginx.conf`:

```nginx
server {
  listen 3000;
  listen [::]:3000;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  location = /health {
    access_log off;
    default_type text/plain;
    return 200 "ok\n";
  }

  location = /index.html {
    add_header Cache-Control "no-cache";
  }

  location /assets/ {
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- [x] **Step 3: Isolate Mail in Compose**

Replace the Mail service's development-anchor inheritance with:

```yaml
mail:
  image: zero-mail-runtime
  build:
    context: .
    dockerfile: docker/mail/Dockerfile
    args:
      VITE_PUBLIC_APP_URL: ${VITE_PUBLIC_APP_URL:-http://localhost:3000}
      VITE_PUBLIC_BACKEND_URL: ${VITE_PUBLIC_BACKEND_URL:-http://localhost:8787}
      VITE_PUBLIC_IMAGE_PROXY: ${VITE_PUBLIC_IMAGE_PROXY:-}
      VITE_PUBLIC_IMAGE_API_URL: ${VITE_PUBLIC_IMAGE_API_URL:-}
  container_name: zerodotemail-mail
  restart: unless-stopped
  depends_on:
    server:
      condition: service_healthy
  ports:
    - '${ZERO_MAIL_PORT:-3000}:3000'
  healthcheck:
    test: ['CMD', 'wget', '--spider', '--quiet', 'http://127.0.0.1:3000/health']
    interval: 10s
    timeout: 5s
    retries: 12
    start_period: 10s
```

Do not change the Server service or the development anchor in this task.

- [x] **Step 4: Remove the dead Mail development command**

Delete this branch from `docker/entrypoint.sh`:

```sh
  mail)
    exec pnpm --dir apps/mail dev --host 0.0.0.0 --port 3000
    ;;
```

Keep the dependency bootstrap and `server)` Wrangler branch unchanged.

- [x] **Step 5: Update the existing Docker architecture assertions**

In `apps/server/tests/architecture/docker-development-stack.test.ts`:

- replace the Vite health assertion with `/health`;
- assert the source/dependency mounts and Chokidar settings remain on Server;
- assert Compose references `docker/mail/Dockerfile` once;
- assert `docker/mail/Dockerfile` uses the Node builder, pnpm `10.15.0`, the
  `@zero/mail` build, and Nginx runtime;
- assert `docker/mail/nginx.conf` contains the `/health`, immutable asset, and SPA fallback
  directives;
- replace the obsolete expectation that the entrypoint starts Mail dev with an expectation that it
  does not contain `pnpm --dir apps/mail dev`;
- retain all database, dependency bootstrap, line-ending, and Server Wrangler assertions.

- [x] **Step 6: Keep the development linter out of production builds**

Add a focused Vite configuration test proving `vite-plugin-oxlint` is enabled for `serve` and
excluded from `build`. Make `apps/mail/vite.config.ts` conditional on the Vite command so production
image builds do not lint copied workspace dependencies during `buildStart`.

- [x] **Step 7: Document the new update workflow**

In `README.md`, replace the statement that all source changes hot-reload with:

````markdown
Docker runs Mail as a prebuilt Nginx static site and keeps the Wrangler backend in development
mode. Server source changes are hot-reloaded. Rebuild Mail after changing frontend source or any
`VITE_PUBLIC_*` value:

```bash
docker compose up --detach --build --no-deps mail
```

`docker compose restart mail` only restarts the existing frontend image.
````

Keep the full-stack startup and database instructions unchanged.

- [x] **Step 8: Run focused architecture tests and verify GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/docker-mail-static-runtime.test.ts tests/architecture/docker-development-stack.test.ts tests/architecture/docker-workspace-dependencies.test.ts
```

Expected: all focused Docker architecture tests pass.

- [x] **Step 9: Validate Compose and file formatting**

Run:

```powershell
docker compose config --quiet
pnpm exec prettier --check compose.yaml README.md apps/mail/vite.config.ts apps/mail/modules/config/vite-config.test.ts apps/server/tests/architecture/docker-mail-static-runtime.test.ts apps/server/tests/architecture/docker-development-stack.test.ts docs/superpowers/plans/2026-07-28-mail-nginx-static-runtime.md
git diff --check
```

Expected: every command exits successfully.

---

### Task 3: Build and verify the real static container

**Files:**

- Verify only; no production files expected.

**Interfaces:**

- Consumes: the `zero-mail-runtime` build and healthy Server container.
- Produces: runtime evidence that Nginx serves the application without development processes.

- [x] **Step 1: Run the complete Mail unit test suite**

Run:

```powershell
pnpm --filter @zero/mail test
```

Expected: all Mail test files pass.

- [x] **Step 2: Build the Mail image**

Run:

```powershell
docker compose build mail
```

Expected: the builder completes `pnpm --filter @zero/mail build`, and the final image contains only
Nginx plus static output.

- [x] **Step 3: Replace only the Mail container**

Run:

```powershell
docker compose up --detach --no-deps mail
```

Expected: `zerodotemail-mail` becomes healthy without restarting Server, PostgreSQL, Valkey, or the
Redis HTTP proxy.

- [x] **Step 4: Verify static and deep-link responses**

Run:

```powershell
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing
Invoke-WebRequest http://localhost:3000/ -UseBasicParsing
Invoke-WebRequest http://localhost:3000/mail/inbox -UseBasicParsing
```

Expected: each response has status `200`; `/health` contains `ok`, and both application responses
contain the built SPA HTML.

- [x] **Step 5: Verify the runtime process boundary**

Run:

```powershell
docker top zerodotemail-mail -eo pid,ppid,pcpu,pmem,rss,vsz,comm,args
```

Expected: Nginx master/worker processes only. No Node, pnpm, React Router, Vite, esbuild, Wrangler,
or workerd process exists.

- [x] **Step 6: Measure idle resources**

After the health check stabilizes, run:

```powershell
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}\t{{.PIDs}}"
```

Expected: Mail memory and CPU are materially below the observed development baseline of
approximately `806 MiB`, `15%` CPU, and `68` PIDs. Report the measured values without asserting an
unmeasured target.

- [x] **Step 7: Review the final workspace**

Run:

```powershell
git status --short
git diff --check
```

Expected: only the planned Mail static-runtime implementation and plan are present; changes remain
uncommitted for user review.
