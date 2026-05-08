# ADR-0001: Enterprise v1 Storage Uses SQLite WAL Behind Repository Abstractions

## Status

Accepted.

## Date

2026-05-08

## Context

SmartPerfetto enterprise v1 targets about 100 internal users, 30-50 concurrent
online users, and 5-15 running analysis runs on a single node or a small-node
deployment. The main feature document explicitly rules out Redis, NATS, Vault
HA, Postgres HA, independent API gateways, and multi-pod stateless scale-out for
the first phase.

The storage decision in §0.3.1 is between SQLite WAL and a single Postgres
instance. The user decision for this milestone is: SQLite WAL plus repository
abstractions.

## Decision

Use SQLite WAL as the authoritative enterprise metadata store for v1.

The backend will keep using `better-sqlite3` with:

- `PRAGMA journal_mode = WAL`
- `PRAGMA busy_timeout = 5000`
- `PRAGMA foreign_keys = ON`

All new enterprise workspace-scoped metadata access must go through repository
abstractions that take an explicit scope:

```ts
interface EnterpriseRepositoryScope {
  tenantId: string;
  workspaceId: string;
  userId?: string;
}
```

Workspace-scoped repositories must append both filters by default:

```sql
tenant_id = @scopeTenantId AND workspace_id = @scopeWorkspaceId
```

Callers may add resource predicates such as `id` or `status`, but they must not
override `tenant_id` or `workspace_id` through ad hoc criteria. This keeps owner
guard behavior in the data access layer instead of relying only on route-level
checks.

## Scope

This ADR settles the v1 storage engine and establishes the repository boundary.
It does not complete every table in §10.2 and does not migrate trace/report/
provider/memory data by itself. Those remain separate §0.3 tasks.

## Consequences

Benefits:

- Minimal new operational dependency for local, source, and Docker users.
- Matches current single-node target while still supporting durable metadata.
- WAL mode gives concurrent readers and one writer, which fits current write
  volume and queue-shadow usage.
- A typed repository boundary gives future Postgres migration a real seam.

Tradeoffs:

- SQLite is not the final shape for multi-region or high-availability SaaS.
- Synchronous `better-sqlite3` writes can block the Node event loop if write
  volume grows beyond the v1 target.
- Cross-process writer coordination remains intentionally out of scope for v1.

Future unlock:

- A Postgres adapter can implement the same repository contracts when the
  deployment target moves to multi-node API workers or HA requirements.
