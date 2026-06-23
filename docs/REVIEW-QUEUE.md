# Deployment & the review queue

The engine is a pure function. [`fold(gate, events) → GateState`](../packages/engine/src/fold.ts) reads no clock, no randomness, no environment; it dedups events by `id`, requires `seq === state.seq + 1`, and replays to the same state every time. That property decides the deployment shape: there is almost nothing to operate. Pick one of two paths.

## Two paths

| | Vercel (default) | Docker / long-running (advanced) |
|---|---|---|
| What runs | the **stateless fold** | **fold + the review queue** |
| Endpoints | `/`, `/health`, `/fold`, `/autodecide` | the above **plus** `/queue/*` |
| State | none — each request is replay-only | one JSON file on a mounted volume |
| Entry | [`api/index.ts`](../api/index.ts), [`vercel.json`](../vercel.json) | [`server.ts`](../server.ts), [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml) |
| Queue routes | answer `501` (no store) | served |
| Deps | none — Node 22 type-strips the TS directly | none — same |

```bash
# Vercel: vercel.json rewrites every path to the /api function.
vercel deploy

# Docker: the queue persists in the named volume queue-data.
docker compose up --build      # -> http://localhost:3000/health
```

The stateless path is enough to verify claims, run checks, and autodecide. You only need the queue when humans (or harnesses) review cases asynchronously: pull work, hold it under a lease, decide, hand it back.

## The queue lifecycle

[`createReviewQueue({ store, leaseSeconds, autoDecide, webhook, now, notifier })`](../packages/engine/src/queue/queue.ts) is the whole API. A case moves through five steps; the per-case event log inside each item is the record.

```
enqueue (push)  ->  assign / route  ->  lease (pull, fenced)  ->  decide  ->  release
```

| Step | Method | Route |
|---|---|---|
| enqueue | `enqueue` | `POST /queue` |
| route | `assign` | `POST /queue/:id/assign` |
| attach evidence | `attachEvidence` | `POST /queue/:id/evidence` |
| lease | `lease` | `POST /queue/lease` |
| decide | `decide` | `POST /queue/:id/decision` |
| release | `release` | `POST /queue/:id/release` |
| inspect | `get` / `list` | `GET /queue/:id`, `GET /queue` |

### Enqueue (push)

```bash
curl -s -X POST localhost:3000/queue \
  -H 'content-type: application/json' \
  -d '{ "gate": { ... }, "events": [ { "type": "claim.submitted", ... } ] }'
```

The gate and any seed events go in. If the gate carries an SLA, `dueAt` is computed at enqueue (see below).

### Assign / route — the delegation trail

Every route, reassign, claim, release, and escalate appends an **immutable** `Assignment` entry. The current inbox and assignee are *derived* from that trail; nothing is edited in place. You read history, you never rewrite it.

```bash
curl -s -X POST localhost:3000/queue/CASE-1/assign \
  -H 'content-type: application/json' \
  -d '{ "inbox": "survey-desk", "by": "ops@example" }'
```

### Lease (pull, fenced)

A reviewer pulls the next case. `lease` filters by `inbox` / `role` / `domain`, hands back one case, and stamps it with a fencing **lease**: a monotonic `{ token, fence }` plus an expiry (`leaseSeconds`, default `300`).

```bash
curl -s -X POST localhost:3000/queue/lease \
  -H 'content-type: application/json' \
  -d '{ "inbox": "survey-desk", "holder": "alice" }'
# -> the leased case, or 204 if nothing is ready
```

The lease is what makes a decision safe under concurrency — see [fencing](#fencing-leases).

### Decide

The decision is a `decision.recorded` event: `{ reviewerRole, outcome, acceptedValues?, note? }`. Money is paid on the **accepted** quantity (`acceptedValues` → surveyed reference → claim), so accepting 117 m³ against a 120 m³ claim certifies `117 × €85 = €9,945` gross, not `€10,200`.

```bash
curl -s -X POST localhost:3000/queue/CASE-1/decision \
  -H 'content-type: application/json' \
  -H 'idempotency-key: dec-CASE-1-v1' \
  -d '{ "leaseToken": "<token-from-lease>", "outcome": "accepted", "acceptedValues": { "quantity": 117 } }'
```

With auth enabled, `reviewerRole` and `actor` are derived from the verified token, never from this body (see [OAuth](#oauth)).

### Release

Hand the lease back, before or after deciding:

```bash
curl -s -X POST localhost:3000/queue/CASE-1/release \
  -H 'content-type: application/json' \
  -d '{ "leaseToken": "<token>" }'
```

## SLA: dueAt, breach, escalate

A gate can declare an SLA:

```jsonc
"sla": { "reviewWithinHours": 24, "priority": "high", "escalateToInbox": "goods-in-escalation" }
```

- **`dueAt`** is set **at enqueue**: `enqueuedAt + reviewWithinHours`.
- **`reap()`** flips every overdue, undecided case to **breached** and appends an immutable escalate assignment `{ kind: "escalate", by: "system:sla" }` routing it to `escalateToInbox`. `reap()` runs before each `lease`, `decide`, and `release`, so the clock is read once, deterministically, at those boundaries.
- **Lease ordering** puts the most urgent work first: **breached first**, then `priority` (`low | normal | high | critical`), then soonest `dueAt`, then FIFO.
- **Inbox counts** report `breached` and `dueSoon`, so a dashboard or harness sees pressure building before anything breaches.

The logistics gate is the worked example: delivery-acceptance, a blocking `date_window` check, `€40/pallet`, a 24h SLA at `priority: high` escalating to `goods-in-escalation`.

## Fencing leases

A leased case can only be decided **under the current lease token**.

| Situation | Result |
|---|---|
| decide a leased case with no token | `409 — case is leased; a lease token is required to decide` |
| decide with a token that isn't the active one | `409 — stale lease: token does not match the active lease` |
| an old holder's lease lapsed and the case was re-leased | the old token is now **stale** → fenced out |

The `fence` is monotonic: each new lease increments it, so a resurrected holder that wakes up after its lease expired cannot overwrite a fresher decision. This is the standard fencing-token pattern — the queue enforces it on `decide` and `release`.

## Idempotent decide

Pass an idempotency key (HTTP: the `Idempotency-Key` header; in-process: `decide(id, { idempotencyKey })`). A retried decide with the **same key** returns the first result and **never double-fires** effects. Effects are keyed independently: each `effectId = sha256(decisionEventId + ':' + ruleId)` sliced to 16 hex, delivered exactly-once through the [outbox](../packages/engine/src/effects.ts) (`createOutbox` / `pending` / `deliver`). Retry freely.

## Notifications are at-most-once

The webhook / notifier is **best-effort, at-most-once**. It is a nudge, not a delivery guarantee. **The queue is the source of truth — poll to reconcile.** If a harness misses a notification, `GET /queue?status=pending` (or a `lease` call) recovers the work; nothing is lost because the notification was the only signal.

```bash
curl -s 'localhost:3000/queue?status=pending&inbox=survey-desk'
```

## Persistence

[`createFileStore(path)`](../packages/engine/src/queue/store.ts) writes the snapshot **atomically** (temp file + rename), so a crash mid-write never leaves a torn queue. `createMemoryStore()` is the in-process variant for tests. In Docker, `QUEUE_FILE` lives on the `queue-data` volume.

## Embedding the gate

The queue is one way to drive the gate. The other is to embed it as a **durable decision step** inside an orchestrator (Temporal, Inngest, Restate, DBOS, Vercel Workflows): the orchestrator owns retries, timers, and at-least-once step execution; Open Gates owns the typed acceptance contract, the deterministic fold, and the audit trail. Wrap I/O in a step; never wrap `fold`. See [DURABLE-EXECUTION.md](DURABLE-EXECUTION.md).

## OAuth

Set `OG_JWT_SECRET` and `/queue/:id/decision` requires a Bearer token whose `og:decide:<role>` scope **proves** the reviewer role; the role and actor come from the token, not the request body. Missing or invalid tokens get `401` with a `WWW-Authenticate: Bearer resource_metadata=...` header pointing at `GET /.well-known/oauth-protected-resource` (RFC 9728). See [MCP.md](MCP.md) for the token model and the agent-facing tools.
