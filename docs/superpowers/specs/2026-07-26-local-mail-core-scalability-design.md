# Local Mail Core Scalability Design

## Status

Approved in principle by the user on 2026-07-26. This document fixes the
implementation boundary for the first improvement project before production
code changes begin.

## Goal

Make Zero's existing local mail core safe for large hosted mail accounts
without changing the current frontend or connecting the Gmail provider.

The project removes account-wide Email and Thread materialization from normal
queries and mutations, replaces full counter rebuilds with bounded incremental
updates, and introduces an indexed local threading mechanism derived from
Stalwart and Sync Engine.

## Global Constraints

- PostgreSQL remains the local mailbox source of truth.
- `packages/mail-core` remains provider-neutral and database-neutral.
- Provider-specific identifiers remain outside core Email, Mailbox, and Thread
  records.
- Existing frontend behavior is unchanged.
- Local Mailbox and Keyword changes are never synchronized back to a provider.
- Development happens directly on the current branch in
  `D:\WorkSpace\Zero`; no Git worktree is used.
- Existing user changes, including the untracked root `AGENTS.md`, are
  preserved.
- Every behavior change follows test-driven development.

## Reference Mechanisms

### Stalwart

Stalwart is the primary semantic and scalability reference:

- It narrows thread candidates through indexed normalized-subject and
  Message-ID reference hashes instead of scanning every message.
- It performs query filtering and ordering through compact indexed
  projections instead of hydrating every Email object.
- It treats aggregate and search data as rebuildable derived state.

Zero will translate these mechanisms into PostgreSQL relations and TypeScript
ports. Zero will not copy Stalwart's Rust types, KV schema, or Roaring Bitmap
storage.

### Sync Engine

Sync Engine provides the relational reference:

- Message-ID and normalized subject participate in indexed thread lookup.
- Thread is a first-class aggregate.
- Category-like membership is normalized separately from Message.
- MIME parts and content-addressed objects remain separate relations.

Zero keeps its existing Email/Mailbox many-to-many model and Blob store. It
does not copy provider-specific Message columns from Sync Engine.

### EmailEngine and Postal

EmailEngine and Postal are not implementation references for this first
project. Their synchronization and delivery mechanisms will be used by later
projects after the local core scalability gate passes.

## Current Problems

### Thread query

`queryThreads` loads every visible Email and every Thread for an account,
groups and sorts them in TypeScript, and slices the page only at the end.
PostgreSQL Email hydration then performs multiple relation queries per Email.

### Thread matching

`importEmail` loads every Email and Thread in an account to match
`Message-ID`, `In-Reply-To`, and `References`. It also scans the account again
when merging threads.

### Aggregate maintenance

Email import, draft mutation, Email state mutation, and destruction recompute
all Mailbox counters from every visible Email. The cost grows with both the
number of Mailboxes and the number of Emails.

### Supporting indexes

Thread ordering, sent-time sorting, size sorting, subject sorting, and
normalized address filters do not all have matching PostgreSQL indexes.

## Architecture

### Query ports

The domain package will gain purpose-specific projection ports instead of
using aggregate repositories for bulk query work:

```ts
export interface ThreadQueryStore {
  query(input: ThreadQueryInput): Promise<ThreadQueryPage>;
  get(input: ThreadGetInput): Promise<ThreadProjection | null>;
}
```

`ThreadQueryPage` contains only the requested page and a bounded set of Email
IDs needed by that page. PostgreSQL performs account scoping, optional Mailbox
filtering, ordering, and keyset pagination.

The port must not expose Drizzle types or SQL concepts.

### Thread reference index

Add `mail0_thread_reference`:

```text
mail_account_id          text, not null
normalized_subject_hash text, not null
message_id_hash          text, not null
email_id                 text, not null
thread_id                text, not null
created_at               timestamptz, not null
```

Constraints and indexes:

```text
primary key (mail_account_id, email_id, message_id_hash)
foreign key (email_id, mail_account_id) -> mail0_email
foreign key (thread_id, mail_account_id) -> mail0_thread
index (mail_account_id, normalized_subject_hash, message_id_hash)
index (mail_account_id, thread_id, email_id)
```

Only a message's own normalized Message-ID is indexed as a lookup target.
Incoming `In-Reply-To` and `References` values are normalized and hashed, then
queried against this relation together with the normalized subject hash.

The hash representation is deterministic lowercase hexadecimal SHA-256. Raw
provider identifiers and raw header values are not used as keys.

### Thread matching flow

For an imported Email:

1. Normalize the subject with the existing local subject rules.
2. Normalize and deduplicate `In-Reply-To` and `References`.
3. Hash the normalized subject and reference Message-IDs.
4. Fetch only matching indexed candidates.
5. Apply the existing deterministic create/use/merge decision.
6. When merging, update Emails and reference rows from loser Threads to the
   winner in the same database transaction.
7. Insert the imported Email's own Message-ID reference after the Email exists.

Emails without a usable Message-ID remain valid but do not create a reference
row.

### Mailbox-thread aggregate

Add `mail0_mailbox_thread`:

```text
mail_account_id   text, not null
mailbox_id        text, not null
thread_id         text, not null
email_count       integer, not null
unread_email_count integer, not null
updated_at        timestamptz, not null
```

Constraints:

```text
primary key (mail_account_id, mailbox_id, thread_id)
email_count > 0
unread_email_count >= 0
unread_email_count <= email_count
```

This table makes Thread-level Mailbox counters incrementally maintainable:

- Creating the row increments `mailbox.totalThreads`.
- Deleting the row decrements `mailbox.totalThreads`.
- Moving `unread_email_count` from zero to positive increments
  `mailbox.unreadThreads`.
- Moving it from positive to zero decrements `mailbox.unreadThreads`.

Email-level Mailbox counters change directly from old and new Email
membership. Thread aggregate counters change directly from Email visibility
and `$seen` transitions.

### Delta input

Counter changes are calculated from immutable before/after projections:

```ts
export type EmailAggregateProjection = {
  emailId: EmailId;
  threadId: ThreadId;
  mailboxIds: MailboxId[];
  visible: boolean;
  unread: boolean;
  hasAttachment: boolean;
  receivedAt: Date;
};
```

Every Email mutation supplies `before` and `after`. Creation uses
`before: null`; permanent destruction uses `after: null`.

The aggregate service updates only affected Thread and Mailbox pairs. It never
calls `emails.listByAccount()`.

### Rebuild and verification

Incremental aggregates remain derived data. Add a bounded maintenance command
that rebuilds one account from SQL truth and reports mismatches before
repairing them.

The rebuild operation is not used by normal Email mutations. It exists for
migration backfill, operational repair, and consistency tests.

## PostgreSQL Index Changes

Add or verify the following indexes:

```text
thread (mail_account_id, latest_received_at desc, id)
email (mail_account_id, sent_at, id)
email (mail_account_id, size_bytes, id)
email (mail_account_id, normalized_subject, id)
email_address (mail_account_id, normalized_email, kind, email_id)
```

Store `normalized_subject` on Email and `normalized_email` on EmailAddress so
normal queries do not depend on unindexed expression evaluation.

Migration order:

1. Add nullable normalized columns and new aggregate/reference tables.
2. Backfill normalized columns, references, and mailbox-thread aggregates in
   bounded batches.
3. Add non-null constraints and indexes after backfill.
4. Switch writes to incremental maintenance.
5. Switch Thread reads to `ThreadQueryStore`.
6. Remove production call paths that perform account-wide rebuilds.

The migration must be restartable. A repeated backfill must converge without
duplicating rows or counters.

## Transactions and Concurrency

The current account row lock remains for the first implementation because it
protects global state allocation and makes aggregate transition correctness
auditable. This project reduces the work performed while holding that lock;
it does not yet replace account-level serialization.

No object-store or provider network operation is added to the new query or
aggregate paths.

Concurrent imports of the same provider Email continue to rely on the existing
remote-email unique key. Concurrent aggregate changes are serialized by the
account lock and database constraints.

Account-lock granularity will be reconsidered only after bounded-query and
bounded-mutation benchmarks exist.

## Error Handling

- Missing or cross-account references retain existing MailCore error codes.
- A malformed Message-ID does not fail Email import; it is excluded from the
  reference index and recorded through the existing parse warning mechanism
  where applicable.
- Counter underflow, an impossible mailbox-thread transition, or a reference
  pointing to a missing Email is reported as `STORAGE_FAILURE`.
- A rebuild mismatch is returned as structured maintenance output; repair
  requires an explicit repair option.

## Testing Strategy

### Domain tests

- Reference normalization and hashing.
- Candidate lookup input construction.
- Deterministic create/use/merge decisions.
- Aggregate deltas for create, move, mark seen/unseen, trash, restore, Thread
  merge, draft creation, and destruction.
- Counter transition boundaries from zero to positive and positive to zero.

### PostgreSQL integration tests

- Thread query returns one page without calling aggregate-list repository
  methods.
- Mailbox filtering and keyset pagination remain stable.
- Reference indexes find only same-account, same-subject candidates.
- Thread merge updates Email, Thread reference, Thread aggregate, Mailbox
  aggregate, search projection, and Changes atomically.
- Concurrent mutations preserve nonnegative counters.
- Rebuild output exactly matches incremental state.
- Backfill is repeatable.

### Scale tests

Use a deterministic fixture with at least:

- 100,000 Emails
- 20,000 Threads
- 30 Mailboxes
- mixed read/unread and multi-Mailbox membership

Acceptance conditions:

- A 50-Thread page does not hydrate account-wide Email records.
- SQL statement count is bounded by page size-independent batches.
- A single Email keyword or Mailbox change does not scan all account Emails.
- Query plans use the new account-prefixed indexes and avoid a full account
  sort.
- Test memory use is bounded by the requested page and affected aggregate
  pairs.

Hardware-dependent latency numbers are recorded as benchmark evidence but are
not the sole pass/fail condition.

## Public API Compatibility

Existing MailCore command names and result shapes remain compatible unless a
new `queryState` field is added in a later Changes/query project.

No frontend route is switched by this project.

## Deliverables

1. Thread query projection port and PostgreSQL implementation.
2. Thread reference schema, repository, backfill, and indexed matching.
3. Mailbox-thread aggregate schema and incremental aggregate service.
4. Normalized Email subject and address storage with matching indexes.
5. Rebuild/verify maintenance command.
6. Unit, integration, concurrency, migration, and scale regression tests.
7. Updated local-mail-core design and omission audit documentation.

## Explicitly Deferred

- Submission local Sent/Outbox/Scheduled projection.
- Persistent delivery claiming and retry leases.
- Blob external-I/O transaction changes.
- Changes retention and query-state versioning.
- Provider-neutral synchronization tables.
- Gmail History synchronization and Gmail API sending.
- JMAP HTTP endpoints and frontend migration.

Each deferred subsystem receives its own design and implementation plan after
this project's verification gate.
