# Remove Pro and Autumn Billing Design

## Summary

Zero will operate as a private, self-hosted service with no Free, Pro, Team, or Enterprise
entitlement tiers. Every authenticated user will have access to every application capability,
subject only to feature-specific configuration, authentication, provider availability, and
ordinary safety or rate limits.

The Autumn billing integration will be removed instead of bypassed. The frontend will not load
customer subscription data, track billable usage, open checkout or billing portals, or display
upgrade messaging. The backend will not expose Autumn proxy routes, initialize Autumn clients,
or require an Autumn secret.

This design makes the self-hosted instance independent of a third-party billing service and
places feature control with the instance operator.

## Goals

- Remove every Free/Pro entitlement check from frontend and backend runtime paths.
- Make AI chat available without a message entitlement or subscription record.
- Allow multiple mail-provider connections without a connection entitlement.
- Make meeting creation depend on `ENABLE_MEET`, not on a Pro product.
- Remove pricing dialogs, upgrade cards, trial calls to action, Pro badges, and billing portal
  controls.
- Remove all runtime Autumn API calls and customer lifecycle integration.
- Remove `autumn-js` from frontend, backend, and workspace dependencies.
- Remove `AUTUMN_SECRET_KEY` from configuration and setup documentation.
- Remove the public pricing route and links that describe unavailable commercial plans.
- Preserve authentication, application rate limits, provider-specific constraints, and
  operator-controlled feature flags.

## Non-goals

- Removing authentication or making the application public.
- Removing abuse-prevention or API rate limits.
- Making disabled or unconfigured external services work automatically.
- Changing AI model selection, AI provider credentials, or AI cost controls outside billing.
- Changing Gmail, Outlook, or future provider quotas imposed by those providers.
- Enabling meetings when `ENABLE_MEET=false` or when the meeting API is unconfigured.
- Adding a replacement payment provider, license server, or local subscription system.
- Introducing a self-hosted-versus-SaaS runtime switch. This fork is intentionally
  self-hosted-only.

## Current State

The billing boundary is distributed across the application:

- `useBilling` maps Autumn customer products and feature balances into `isPro`, chat message,
  connection, and brain activity states.
- `pricingDialog=true` opens a query-string-controlled checkout dialog.
- AI chat renders an upgrade overlay and disables submission when the chat feature balance is
  unavailable.
- Connection entry points open the pricing dialog for non-Pro customers, while the connection
  dialog independently disables provider buttons when no connection balance remains.
- The AI sidebar records Autumn usage after tool calls and displays a usage gauge and upgrade
  action.
- Navigation displays upgrade, trial, Pro badge, verification, and billing portal controls.
- The meeting procedure retrieves an Autumn customer and rejects non-Pro customers.
- User deletion attempts to delete the matching Autumn customer.
- The server exposes an `/autumn` proxy for customer, entitlement, usage, checkout, billing
  portal, entity, and pricing-table operations.
- Frontend and backend packages both depend on `autumn-js`.
- Setup documentation and environment types treat `AUTUMN_SECRET_KEY` as required.

Most application restrictions are currently frontend-only. Meeting creation is the only
identified feature with an explicit backend Pro check.

## Target Architecture

### Capability model

Authentication answers whether a user may use the private application. Feature-specific
configuration answers whether an optional service is enabled. There is no subscription or
product tier between those decisions.

```text
authenticated user
    -> application capability
    -> feature configuration and provider availability
    -> operation
```

The runtime must not ask a billing provider whether an authenticated user may proceed.

### AI chat

AI chat will render its normal empty, conversation, and error states without consulting
`useBilling`.

- Remove the exhausted-entitlement overlay.
- Keep the send button enabled whenever normal chat state permits submission.
- Remove the Autumn usage gauge and upgrade action.
- Remove the `track({ featureId: 'chat-messages' })` call and billing refetch.
- Preserve AI request errors, tool-call handling, model configuration, and existing agent
  behavior.

Removing billing metering does not remove ordinary AI provider costs. The operator remains
responsible for configuring provider credentials and any provider-side budget controls.

### Mail-provider connections

Every connection entry point will open `AddConnectionDialog`, regardless of former Pro state.
The dialog will not compute a billing balance, show a free-tier warning, or disable providers
because of an entitlement.

Connection creation will continue through Better Auth social account linking and the existing
server-side connection hook. OAuth failures, missing tokens, duplicate/provider behavior, and
provider quotas remain handled by their existing boundaries.

### Meetings

The meeting procedure will retain:

- authenticated active-driver access;
- its existing request rate limit;
- the `ENABLE_MEET` feature switch;
- meeting API configuration and response validation.

It will remove the Autumn customer lookup and `isProCustomer` rejection. When
`ENABLE_MEET=false`, the current not-implemented response remains the controlling behavior.

### Navigation and public pages

The authenticated UI will remove:

- pricing dialog triggers and mounts;
- upgrade and trial cards;
- usage-to-upgrade prompts;
- Pro-only badges and "Get verified" upsells tied to Pro;
- billing portal entries.

The public `/pricing` route, pricing navigation links, and pricing-only components will be
removed. Requests to `/pricing` will follow the router's normal not-found behavior; no
replacement commercial page or redirect is required.

Privacy, setup, onboarding email, and other user-facing text will be updated so the repository
does not advertise subscriptions, trials, refund rules, pricing pages, or Autumn setup that no
longer exist. Pricing-only images or UI helpers will be removed only when repository-wide
reference checks confirm they are unused.

### Autumn removal

The frontend will remove:

- `AutumnProvider`;
- `useBilling`;
- frontend `isProCustomer` and Autumn customer types;
- pricing dialog and pricing-only components;
- every `autumn-js` import and dependency.

The backend will remove:

- the `/autumn` route and route module;
- Autumn state from request context;
- Autumn customer deletion during local user deletion;
- backend `isProCustomer` and Autumn customer types;
- the Autumn lookup in meeting creation;
- `AUTUMN_SECRET_KEY` from environment types;
- every `autumn-js` import and dependency.

The workspace catalog and lockfile will be regenerated so `autumn-js` is absent when no other
package requires it.

## Data Flow

### AI request

1. An authenticated user enters a prompt.
2. The frontend submits it directly through the existing agent chat connection.
3. The agent processes the request and returns streaming output or an error.
4. No customer fetch, entitlement check, usage track, or billing refetch occurs.

### Connection creation

1. An authenticated user opens the connection dialog from settings or account navigation.
2. The user selects an available provider.
3. Better Auth starts social account linking.
4. The existing backend hook validates tokens and creates the connection.
5. No product lookup or connection-balance check occurs.

### Meeting creation

1. An authenticated user invokes meeting creation.
2. The server applies the existing request rate limit.
3. The server checks `ENABLE_MEET`.
4. When enabled, the server calls the configured meeting API directly.
5. No Autumn customer request or Pro check occurs.

## Error Handling

- Missing authentication remains an authorization failure.
- Missing active mail-provider state retains the existing driver-specific error behavior.
- OAuth and provider errors remain visible through the current connection flow.
- AI provider, streaming, and tool errors retain their existing handling.
- `ENABLE_MEET=false` continues to return the existing disabled/not-implemented response.
- Missing or invalid meeting API configuration produces the existing meeting integration
  failure, not a billing error.
- No runtime path may fail because `AUTUMN_SECRET_KEY` is absent.
- Removed `/autumn` and `/pricing` routes use normal router not-found behavior.

## Documentation and Configuration

The following configuration and documentation surfaces will be aligned with the self-hosted
architecture:

- remove `AUTUMN_SECRET_KEY` from `.env.example` and server environment types;
- remove Autumn setup instructions from `README.md`;
- update `AGENT.md` so it no longer describes Autumn as an important environment variable;
- remove subscription, trial, refund, and pricing-page statements from privacy or other static
  pages where they describe functionality this instance does not offer;
- remove public and email links to `/pricing`;
- retain `ENABLE_MEET` as the operator-owned meeting switch.

No new billing or entitlement environment variable will replace Autumn.

## Testing

### Static verification

- No runtime source or package manifest references `pricingDialog`, `useBilling`,
  `isProCustomer`, `AutumnProvider`, `AUTUMN_SECRET_KEY`, or `autumn-js`.
- No application navigation or email template links to `/pricing`.
- No source displays upgrade, trial, billing portal, or subscription-tier controls.
- The workspace lockfile contains no `autumn-js` package unless a transitive dependency still
  requires it; any remaining transitive use must be documented.

### Frontend behavior

- AI chat renders and submits without Autumn customer data.
- AI chat remains usable when no former entitlement state exists.
- Connection controls always open `AddConnectionDialog`.
- Provider connection buttons are not disabled by former billing balances.
- Navigation and settings render without `AutumnProvider`.
- No pricing or upgrade UI appears.
- `/pricing` is no longer registered.

### Backend behavior

- Meeting creation with `ENABLE_MEET=true` reaches the meeting API without an Autumn request.
- Meeting creation with `ENABLE_MEET=false` remains disabled.
- User deletion succeeds without attempting Autumn customer deletion.
- The server starts and handles authenticated requests without `AUTUMN_SECRET_KEY`.
- `/autumn` is no longer registered.

### Regression verification

- Targeted frontend type checking and build verification.
- Targeted backend type checking and Worker build verification.
- Existing authentication and local administrator tests.
- Existing Gmail connection linking and connection listing.
- AI chat request and tool-call behavior.
- Meeting route tests for enabled, disabled, upstream-success, and upstream-failure states.

## Acceptance Criteria

The change is complete when:

1. the application starts without `AUTUMN_SECRET_KEY` and makes no Autumn requests;
2. every authenticated user can use AI chat without a product or message balance;
3. every authenticated user can add multiple mail-provider connections without a product or
   connection balance;
4. meeting creation depends on `ENABLE_MEET` and meeting service configuration only;
5. no Pro, upgrade, trial, pricing, subscription, or billing portal UI remains;
6. the public pricing route and all links to it are removed;
7. `autumn-js` is removed from direct workspace dependencies;
8. runtime source contains no Pro/Autumn entitlement code;
9. targeted frontend and backend verification succeeds without regressions to authentication,
   provider connections, AI chat, or meetings.
