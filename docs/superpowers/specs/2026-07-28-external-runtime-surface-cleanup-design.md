# External runtime surface cleanup design

## Goal

Remove dormant external telemetry, orphan analytics consent infrastructure, and
non-essential automatic frontend network requests from Zero. Preserve only
network access that is required for the local mailbox product or explicitly
initiated by the user.

## Scope

### React Scan

- Remove the conditional React Scan script from the mail application root.
- Remove the `REACT_SCAN` environment declaration and any remaining
  configuration references.
- Add an architecture boundary that rejects React Scan and `unpkg.com` runtime
  scripts.

### Axiom and OpenTelemetry

- Remove the direct `@microlabs/otel-cf-workers` and `@opentelemetry/api`
  dependencies and their lockfile records.
- Delete the unused OpenTelemetry tracing adapter.
- Remove Axiom and OTLP environment declarations and Wrangler configuration.
- Remove the commented OpenTelemetry instrumentation and exporter code from the
  server entrypoint.
- Preserve the in-memory `TraceContext`: it does not export data and is not part
  of the OpenTelemetry integration.

### Cookie analytics

- Remove `@coinbase/cookie-manager` and its lockfile records.
- Delete the unused cookie category and preference module.
- Delete the cookie-preference TRPC router and remove it from the public TRPC
  router.
- Remove the remaining commented frontend cookie-preference reference.
- Preserve authentication and session cookies managed by Better Auth and Hono.

### Non-essential frontend requests

- Remove the navigation request for GitHub repository statistics and its dynamic
  star count.
- Delete the `/contributors` route, page, and navigation/footer links to that
  local page. This also removes GitHub contributor, repository, commit and pull
  request API calls and automatically loaded GitHub avatars.
- Replace `placehold.co` images with local, non-networked UI.
- Remove the React Scan remote script described above.

## Preserved network behavior

The following behavior is outside this cleanup and must continue to work:

- Calls to Zero's configured frontend and backend origins.
- Gmail, Google Pub/Sub, Nango, and other configured mail-provider integration
  calls.
- Attachment and blob access through Zero's backend.
- List-Unsubscribe actions explicitly initiated by the user.
- External links explicitly opened by the user.
- Remote images in email content only after the user enables them globally,
  temporarily, or trusts the sender.
- BIMI and configurable Nango URL behavior previously deferred by the user.

## Tests

Extend the existing external-telemetry architecture test so it rejects:

- React Scan, `unpkg.com`, Axiom and the removed OpenTelemetry dependencies and
  configuration.
- `@coinbase/cookie-manager` and the removed cookie-preference router.
- GitHub API calls, `placehold.co` assets, and the deleted contributors route.

Use a red-green cycle: first add assertions and verify that they fail against
the current tree, then make the minimum removals required for them to pass.
Afterward run the focused architecture test, mail and server type checks, and
the relevant lint checks.

## Success criteria

- The browser does not automatically download code or display assets from the
  removed third-party hosts.
- The server contains no Axiom/OpenTelemetry exporter surface.
- The application contains no unused analytics/marketing cookie-consent API.
- Required mailbox and user-initiated external behavior remains unchanged.
- Package manifests and the lockfile contain none of the removed direct
  dependencies.
- Automated architecture checks prevent the deleted surfaces from returning.
