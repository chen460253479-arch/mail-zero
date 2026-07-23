# Local Superadmin Authentication Implementation Plan

**Goal:** Allow a privately deployed Zero instance to use one local email/password
superadmin account, created either from environment variables or with
`pnpm nizzy create-admin`, while keeping public registration disabled and allowing
the administrator to enter the mail UI before connecting a provider.

## 1. Authentication and provisioning

- Enable Better Auth email/password sign-in without email verification.
- Keep public sign-up disabled.
- Add a server-side provisioning service that creates exactly one administrator
  and its Better Auth credential account.
- Add an environment-driven first-request bootstrap path.
- Add a bootstrap-secret-protected HTTP endpoint for the CLI.
- Skip Gmail/Outlook connection hooks for credential accounts.

## 2. Database and configuration

- Add an administrator role to the Better Auth user table.
- Generate the next Drizzle migration.
- Document the auto-provision and bootstrap environment variables.

## 3. CLI and login UI

- Add `pnpm nizzy create-admin` with interactive name, email, password, backend
  URL, and bootstrap secret inputs.
- Replace provider-only login with local email/password login.
- Do not expose a registration path.

## 4. Provider-independent shell

- Make the active connection query return `null` when none exists.
- Keep provider-backed mail queries disabled until a connection exists.
- Show a useful empty state and provider-connection action inside the authenticated
  application shell.
- Disable compose and refresh actions without an active connection.

## 5. Verification

- Run focused provisioning policy tests.
- Run server type checking / Wrangler dry-run.
- Build the mail application.
- Confirm the CLI command is discoverable and type-correct.
