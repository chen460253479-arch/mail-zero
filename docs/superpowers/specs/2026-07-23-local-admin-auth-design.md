# Local Superadmin Authentication Design

## Summary

Zero will support a private, self-hosted authentication mode in which one local superadmin
signs in with an email address and password. Creating or signing in to this Zero account will
not require Google OAuth, email verification, or an existing mail-provider connection.

The administrator can enter the full application shell without connecting a mailbox. In that
state, provider-dependent operations are unavailable and the mail area shows an actionable
empty state instead of redirecting, repeatedly failing requests, or crashing.

This change does not integrate Nango and does not redesign the existing Gmail, Outlook, or
future Zoho mail drivers.

## Goals

- Enable Better Auth email-and-password authentication.
- Support exactly one local Zero user with the `admin` role.
- Disable public user registration.
- Provision the administrator either automatically from environment variables or manually
  with `pnpm nizzy create-admin`.
- Allow the administrator to sign in without verifying the login email address.
- Keep Zero authentication independent from mail-provider connections.
- Allow `/mail/inbox`, the navigation shell, and settings pages to render without an active
  mail connection.
- Prevent provider-dependent queries and mutations from producing request loops or noisy
  errors when no mail connection exists.
- Preserve the existing Gmail connection flow for optional later use.

## Non-goals

- Nango integration.
- Outlook or Zoho enablement.
- A multi-user administration console.
- Public registration, invitations, or self-service account creation.
- Hosting an `@0.email` mailbox.
- Replacing the existing mail-provider driver or synchronization architecture.
- Offline access to previously synchronized mail after a provider is disconnected. That
  requires a broader mail-storage and connection-state redesign.

## Architecture

### Identity and mailbox separation

Better Auth owns the Zero login identity. Mail-provider connections remain separate resources.
The local credential account must not be converted into a mail connection.

The existing Better Auth account database hook currently assumes every new account is an OAuth
mail-provider account with access and refresh tokens. The hook will ignore Better Auth's
credential provider. Google OAuth accounts will continue through the existing connection
handler.

### Single-user invariant

The instance supports one user only. The provisioning service creates a user only when the user
table is empty. Once a user exists:

- public email registration remains denied;
- automatic provisioning becomes a no-op after validating that the existing account is not
  being overwritten;
- `nizzy create-admin` exits with a clear error;
- no provisioning path changes the existing email address or password.

The user record will contain `role = 'admin'`. Existing authenticated product operations remain
scoped to this user. The role also establishes an explicit authorization boundary for future
administrative endpoints, although this change does not add an admin dashboard.

### Shared administrator provisioning service

Both provisioning entry points call one server-side `provisionAdmin` service. This service:

1. validates name, email, and password;
2. acquires a database-level single-user creation guard;
3. confirms that no user exists;
4. creates the credential account through Better Auth-compatible password hashing and records;
5. assigns the `admin` role;
6. initializes the user's default settings;
7. returns a sanitized result without password or password hash.

The service is idempotent with respect to concurrent first-start requests: one request may
succeed and all others receive an "administrator already exists" result.

## Provisioning entry points

### Environment auto-provisioning

The following variables configure automatic provisioning:

```env
ZERO_ADMIN_AUTO_PROVISION=false
ZERO_ADMIN_NAME=Admin
ZERO_ADMIN_EMAIL=admin@example.com
ZERO_ADMIN_PASSWORD=
```

When `ZERO_ADMIN_AUTO_PROVISION=true`, the server lazily checks provisioning during the first
request that initializes authentication. Lazy initialization is used because the Cloudflare
Worker runtime does not provide a conventional one-time application startup hook.

If no user exists and any required administrator variable is missing or invalid, the
authentication service returns a configuration error and does not create partial records.

If a user already exists, the environment values never reset or overwrite it. Operators should
remove `ZERO_ADMIN_PASSWORD` after successful provisioning and use a secret store rather than a
plain committed environment file in production.

### Nizzy CLI provisioning

`pnpm nizzy create-admin`:

- verifies that it is running from the project root;
- reads `VITE_PUBLIC_BACKEND_URL`, `ZERO_ADMIN_NAME`, `ZERO_ADMIN_EMAIL`,
  `ZERO_ADMIN_PASSWORD`, and `ZERO_ADMIN_BOOTSTRAP_SECRET` from the root `.env`;
- uses every valid configured value directly, including the administrator password and bootstrap
  secret;
- prompts only for values that are missing or invalid;
- hides any password or bootstrap-secret input requested interactively;
- never writes credentials to disk or logs them;
- calls a protected server provisioning route;
- reports configuration, validation, connectivity, and already-initialized errors distinctly.

Environment values have priority over interactive input. A fully configured `.env` therefore makes
`pnpm nizzy create-admin` non-interactive. Password confirmation is required only when the password
must be entered interactively; an environment-provided password is validated but never displayed or
echoed for confirmation.

The protected route requires a bootstrap secret and also enforces the empty-user-table rule.
Knowing the secret is not sufficient to create another account after initialization.

The bootstrap secret is configured as:

```env
ZERO_ADMIN_BOOTSTRAP_SECRET=
```

### Password recovery

`pnpm nizzy reset-admin-password` provides local recovery for the sole administrator. It
requires the bootstrap secret, confirms the existing administrator identity, accepts a hidden
new password twice, and updates the Better Auth credential through the same password hashing
mechanism. It does not depend on email verification or Resend.

## Authentication behavior

### Better Auth configuration

- `emailAndPassword.enabled` is enabled.
- Email verification is not required.
- Email verification is not sent on signup.
- Public signup requests are rejected unless they are part of an authorized administrator
  provisioning request.
- Existing session lifetime and cookie settings remain unchanged.
- Login receives rate limiting appropriate for a single-user private instance.

### Login UI

`/login` presents:

- email;
- password;
- submit button;
- useful invalid-credentials and server-configuration errors.

It does not present public signup or Google-as-login buttons. Google remains available only in
the authenticated connections settings flow.

After successful login, the application redirects to `/mail/inbox`.

## No-mailbox application state

An authenticated administrator without a mail connection can use:

- the application shell and sidebar;
- `/mail/inbox`;
- settings pages;
- account and appearance controls that do not require a provider.

The mail area displays an empty state explaining that no mail provider is configured. It does
not force navigation to the Gmail connection page.

Provider-dependent UI is disabled with a clear explanation, including:

- synchronization and refresh;
- compose and send;
- draft operations backed by a provider;
- remote labels and folders;
- remote search and message mutations.

Connection-dependent React Query requests are disabled when there is no active connection.
Backend procedures that genuinely require a driver retain explicit connection errors, but the
no-connection UI must not invoke them.

The existing connections settings page remains accessible so Gmail can still be linked
manually. Nango will replace or extend this boundary in a later project.

## Data model

The Better Auth user schema gains a role field with a safe default:

```text
role: "admin" | "user"
```

The provisioned singleton receives `admin`. The existing account table already contains the
credential password field and the verification table already exists, so no new password table
is required.

A database migration adds the role column and any constraint or index required by the chosen
Drizzle representation. The provisioning transaction and an existing unique user email
constraint protect against duplicate administrators; an additional database-level lock or
singleton guard will protect the empty-table check from races.

## Error handling

- Partial environment configuration produces a configuration error listing missing variable
  names but never their values.
- Weak or mismatched passwords fail before a network or database call.
- Passwords must be at least 12 characters.
- Existing-user provisioning attempts fail without mutation.
- Credential account creation never invokes OAuth token handling.
- An unavailable backend produces a CLI connectivity error.
- A missing bootstrap secret produces an authorization error.
- A failed default-settings initialization rolls back administrator creation where the
  persistence boundary permits it; otherwise provisioning records a recoverable initialization
  failure and retries settings initialization without creating another user.
- Login errors do not reveal whether an email address exists.

## Testing

### Unit and integration tests

- Environment configuration parsing and validation.
- CLI environment-value precedence and missing-value fallback prompts.
- Non-interactive CLI provisioning from a complete `.env`.
- Automatic provisioning with a valid configuration.
- No-op behavior after an administrator exists.
- Rejection of partial configuration.
- Rejection of weak passwords.
- Concurrent provisioning creates exactly one user.
- Public signup is rejected.
- Authorized CLI provisioning succeeds once.
- Invalid bootstrap secrets are rejected.
- Credential accounts do not invoke the OAuth connection handler.
- Administrator role is stored and returned in the session.
- Password login succeeds and invalid credentials fail generically.
- Password reset requires authorization and preserves the singleton user.

### UI tests

- Login page renders email and password fields without signup or Google-login controls.
- Successful login redirects to `/mail/inbox`.
- An administrator with no connection can render the mail shell.
- No-connection inbox renders the empty state.
- Provider-dependent controls are disabled.
- No driver-dependent queries are sent in the no-connection state.
- Settings and Gmail connection pages remain reachable.

### Regression verification

- Frontend production build.
- Cloudflare Worker dry-run build.
- Existing Gmail account linking still creates a mail connection.
- Existing authenticated sessions remain valid where Better Auth schema compatibility permits.
- Existing connected Gmail users can still open the inbox, sync, and send mail.

## Acceptance criteria

The change is complete when:

1. a clean database can create one administrator through either environment auto-provisioning
   or `pnpm nizzy create-admin`;
2. no public request can register a second user;
3. the administrator can log in with email and password without email verification;
4. the administrator reaches `/mail/inbox` without a mail connection;
5. the no-connection mail UI remains stable and does not issue driver-dependent request loops;
6. Gmail remains an optional connection available after login;
7. credential account creation never enters the OAuth mail-connection hook;
8. automated tests cover provisioning, login, registration denial, singleton enforcement, and
   the no-connection UI;
9. targeted frontend and backend build verification succeeds.
