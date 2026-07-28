# Docker Deploy Command Design

## Goal

Provide one cross-platform root command, `pnpm docker:deploy`, that builds and starts the complete
current Docker Compose stack without clearing PostgreSQL data.

## Command Contract

The root `package.json` script runs these operations in order:

1. `docker compose build`
2. `docker compose run --rm --no-deps server install-dependencies`
3. `docker compose up --detach --wait --wait-timeout 180`
4. `docker compose ps`

The dependency bootstrap uses the existing Server development image and named dependency volumes.
`--no-deps` prevents the temporary bootstrap container from starting PostgreSQL, Valkey, or the
Redis HTTP proxy before the complete stack is started.

Compose performs the existing service health checks and fails the command when the stack does not
become healthy within 180 seconds. The final `compose ps` gives the operator a concise deployment
result.

## Safety Boundary

- The command never runs `db:push`, migrations, or seed commands.
- The command never runs `docker compose down`, `--volumes`, or any database cleanup operation.
- Existing PostgreSQL and Valkey named volumes remain intact.
- The command builds and starts the current stack as defined. Mail is a static Nginx runtime, while
  Server remains the existing Wrangler development runtime until the separate self-hosted Server
  conversion is implemented.

## Documentation and Regression Coverage

The README exposes `pnpm docker:deploy` as the normal complete-stack startup/update command and
keeps the Mail-only rebuild command for frontend-only updates.

The Docker architecture test parses the root package scripts and protects command presence,
operation order, health waiting, dependency isolation, and the absence of destructive database or
volume operations.
