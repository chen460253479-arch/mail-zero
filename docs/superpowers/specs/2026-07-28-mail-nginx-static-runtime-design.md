# Mail Nginx Static Runtime Design

## Goal

Replace the Docker Mail service's React Router/Vite development runtime with a build-once static
artifact served by Nginx. The Server service remains on its current Wrangler development runtime
during this phase.

## Selected Approach

Use a dedicated multi-stage Mail image:

1. A Node.js builder installs the pinned pnpm workspace dependencies and runs the existing
   `@zero/mail` production build.
2. An Nginx runtime image receives only `apps/mail/build/client` and the Mail-specific Nginx
   configuration.
3. Docker Compose builds that image with public frontend URLs supplied as build arguments.

This phase keeps the existing single `compose.yaml`. It deliberately creates a temporary mixed
runtime: static Mail plus development Server. Development/runtime profiles are a later, separate
change.

## Image and Directory Structure

Mail-owned Docker files live together:

```text
docker/
  mail/
    Dockerfile
    nginx.conf
```

`docker/mail/Dockerfile` has a dependency/build stage based on the same Node.js and pnpm versions as
the existing Server development image. Its runtime stage uses the official Nginx Alpine image.

The Nginx image contains no repository source, workspace `node_modules`, `.env` file, database
credential, Redis credential, Gmail credential, or Server secret.

## Build-Time Configuration

The frontend currently reads public configuration through `import.meta.env`, so these values are
compiled into the browser bundle:

- `VITE_PUBLIC_APP_URL`, defaulting to `http://localhost:3000`;
- `VITE_PUBLIC_BACKEND_URL`, defaulting to `http://localhost:8787`;
- `VITE_PUBLIC_IMAGE_PROXY`, optional;
- `VITE_PUBLIC_IMAGE_API_URL`, optional.

These are Docker build arguments and build-stage environment variables. They are public browser
configuration, not secrets.

`VITE_INTERNAL_BACKEND_URL` is not supplied to the static Mail build. SPA route loaders execute in
the browser and use the public backend URL.

Changing source code or any compiled public URL requires rebuilding the Mail image:

```powershell
docker compose up -d --build --no-deps mail
```

`docker compose restart mail` only restarts the existing image and does not publish new code.
Building during container startup is explicitly excluded because it would preserve high build-time
memory, slow every restart, and make runtime startup nondeterministic.

## Nginx Runtime

Nginx listens on container port `3000`.

- `/assets/` serves fingerprinted build assets with immutable caching.
- Existing files are served directly.
- Unknown application paths fall back to `/index.html`, preserving React Router deep links such as
  `/mail/inbox`, `/login`, and `/settings/integrations`.
- `/health` returns a small direct Nginx response for the Compose health check.

The Mail health check no longer requests `/@vite/client`, because Vite is absent at runtime.

## Compose Boundary

The Mail service no longer inherits the shared `zero-development` anchor. It has:

- its own `build` and image;
- no repository bind mount;
- no workspace dependency volumes;
- no `env_file` at runtime;
- no Chokidar polling variables;
- no Mail development command or development entrypoint;
- the existing dependency on a healthy Server;
- the existing host port mapping.

The Server service continues to inherit `zero-development`, including its source mount, persisted
workspace dependencies, Wrangler state, database/Redis configuration, and current health check.

The obsolete `mail)` branch is removed from `docker/entrypoint.sh`; that entrypoint remains owned by
the Server development image.

## Documentation

The Docker section of `README.md` will state:

- Mail runs from a static Nginx image;
- Server source changes remain hot-reloaded during this transitional phase;
- Mail source or public URL changes require `docker compose up -d --build --no-deps mail`;
- `docker compose restart mail` does not rebuild the frontend.

## Verification

Architecture tests will protect the static Mail boundary before implementation:

- dedicated Mail Dockerfile and Nginx configuration exist;
- Compose builds Mail from `docker/mail/Dockerfile`;
- Mail does not inherit the development anchor or mount source/dependency volumes;
- Mail health checks `/health`, not `/@vite/client`;
- Server retains the development entrypoint and dependency volumes;
- the obsolete Mail development entrypoint command is absent;
- documentation describes the rebuild workflow.

Implementation verification then runs:

1. focused architecture tests;
2. `docker compose config`;
3. the complete Mail unit test suite;
4. `docker compose build mail`;
5. replacement of only the Mail container;
6. HTTP checks for `/health`, `/`, and a deep SPA route;
7. a process check proving the Mail container has no Node, Vite, esbuild, Wrangler, or workerd
   process;
8. an idle `docker stats --no-stream` comparison against the observed baseline of approximately
   `806 MiB` and `15%` CPU.

No implementation commit or push occurs until explicitly requested.
