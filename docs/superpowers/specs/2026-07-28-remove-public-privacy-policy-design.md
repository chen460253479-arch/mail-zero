# Remove the Public Privacy Policy Design

## Goal

Remove the inaccurate public privacy-policy surface from Zero without removing mailbox privacy and
security controls.

## Scope

The public `/privacy` page will be deleted together with every application-owned link or navigation
entry that opens it. The route must no longer be registered, so `/privacy` falls through to the
existing not-found route.

The following surfaces are included:

- the public privacy-policy page;
- the `/privacy` route declaration;
- login and sign-up privacy-policy links;
- public navigation and footer privacy-policy links;
- authenticated user-menu privacy-policy links;
- architecture tests that still treat the deleted page as a production surface.

## Explicitly Preserved

The authenticated `/settings/privacy` page remains available. It controls remote-email-image and
trusted-sender behavior and is a standard mailbox security capability, not the public policy page.
Its route, navigation item, translations, and settings behavior must not be removed.

Generic product copy that uses the word `privacy` without linking to `/privacy` is outside this
change.

Historical implementation plans remain historical records and are not rewritten.

## Verification

An architecture test will assert that:

- the public privacy-policy file no longer exists;
- the public `/privacy` route is absent;
- production mail-application source contains no link to `/privacy`;
- the `/settings/privacy` route and page remain present.

The test must fail before deletion and pass afterward. Mail type-checking, focused linting, and a
repository diff check will then validate the removal.
