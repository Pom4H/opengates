# MCP server — native agent review

> Level 5 of the [ladder](../README.md#whats-in-this-repository). An
> [MCP](https://modelcontextprotocol.io) wrapper around the review queue, so
> Claude (or any MCP client) works cases as **tools** — lease → judge → decide —
> instead of hand-building `curl` calls and lease tokens.

## What it is

[`packages/engine/src/mcp/server.ts`](../packages/engine/src/mcp/server.ts) is a small,
**dependency-free** MCP server — its own JSON-RPC 2.0 over stdio, no SDK, in
keeping with the rest of the repo. It is a thin **client** of a running review
queue (the [Docker / `server.ts`](REVIEW-QUEUE.md) deployment), so the queue
stays the single source of truth: leases, the delegation trail, persistence and
the deterministic `fold` all live there. The MCP server adds no state of its own.

It exposes seven tools:

| Tool | Maps to | Purpose |
|------|---------|---------|
| `open_gates_lease` | `POST /queue/lease` | Pull the next pending case (filter by inbox/role/domain) |
| `open_gates_get` | `GET /queue/:id` | Fetch one case + its delegation trail |
| `open_gates_list` | `GET /queue` | List cases (by status/domain/inbox/assignee) |
| `open_gates_decide` | `POST /queue/:id/decision` | Record a decision (the engine folds it in) |
| `open_gates_release` | `POST /queue/:id/release` | Hand a leased case back undecided |
| `open_gates_enqueue` | `POST /queue` | Push a new case (producer side) |
| `open_gates_inboxes` | `GET /inboxes` | Inbox load with per-inbox counts |

The engine's invariants still hold — a positive decision needs passing blocking
checks, only the gate's reviewer role may decide — because every tool call goes
through the same HTTP API and the same `fold`.

## Run it

First, have a queue running (see [REVIEW-QUEUE.md](REVIEW-QUEUE.md)):

```bash
npm run serve            # queue on :3000
```

Then point the MCP server at it:

```bash
OPEN_GATES_URL=http://localhost:3000 npm run mcp
# env: OPEN_GATES_URL (default http://localhost:3000), OPEN_GATES_TOKEN (bearer, when the queue requires auth)
```

It speaks JSON-RPC on stdin/stdout; diagnostics go to stderr. You normally don't
run it by hand — an MCP client launches it.

### Register with Claude Code

```bash
claude mcp add open-gates \
  --env OPEN_GATES_URL=http://localhost:3000 \
  -- node /absolute/path/to/opengates/packages/engine/src/mcp/server.ts
```

Or add it to a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "open-gates": {
      "command": "node",
      "args": ["packages/engine/src/mcp/server.ts"],
      "env": { "OPEN_GATES_URL": "http://localhost:3000" }
    }
  }
}
```

## Authority — OAuth 2.1, proven by token scope

A decision is an act of authority, so the queue never trusts a `reviewerRole`
sent in a request body. Run the server with **`OG_JWT_SECRET`** set and
`/queue/:id/decision` requires an OAuth 2.1 Bearer token; the engine
([`packages/engine/src/auth.ts`](../packages/engine/src/auth.ts)) derives the reviewer role and the
actor from the **token**, never the tool input:

| Scope | Grants |
|-------|--------|
| `og:read` | read cases (`open_gates_get`, `open_gates_list`, `open_gates_inboxes`) |
| `og:enqueue` | push cases / attach evidence |
| `og:lease` | lease and release cases |
| `og:decide:<role>` | decide a gate whose `reviewer.role` is `<role>` (or `og:decide:*`) |

`authorizedRole(principal, gateRole)` returns the proven role or `403`; the actor
recorded is the token subject. The MCP client forwards `OPEN_GATES_TOKEN` as the
bearer on every call, so a scoped agent simply gets a scoped token.

Mint one (dependency-free, HS256 — same secret the server runs with):

```bash
OG_JWT_SECRET=… npm run token -- --actor supervisor:ivanov --role technical_supervisor --ttl 86400
# -> a JWT; export it as OPEN_GATES_TOKEN for the MCP client / curl reviewer
```

The resource advertises its authorization server per **RFC 9728** at
`GET /.well-known/oauth-protected-resource`; a missing or invalid token yields
`401` with `WWW-Authenticate: Bearer resource_metadata="…"`. Audience binding
follows **RFC 8707** (`OG_RESOURCE_URI` / `OG_ISSUER`). The verifier is
dependency-free HS256 or a pluggable `verify` hook for RS256/JWKS;
[`.well-known/oauth-protected-resource.json`](../.well-known/oauth-protected-resource.json)
is a sample metadata document. With no secret set, auth is off and the queue is
open — fine for local dev, not for a shared deployment.

## Hooks — invariants the agent cannot skip

[`.claude/hooks/hooks.json`](../.claude/hooks/hooks.json) wires two hooks around
`open_gates_decide`:

- **PreToolUse** → [`check-gate.mjs`](../.claude/hooks/check-gate.mjs)
  hard-**denies** a positive outcome when the case's blocking checks have not
  passed (it asks the engine at `OPEN_GATES_URL`) — before the call leaves.
- **PostToolUse** → [`audit-append.mjs`](../.claude/hooks/audit-append.mjs)
  appends the decision to `.claude/decisions.jsonl`.

The engine already refuses a positive decision over a failed blocking check
(`422`); the hook denies it one layer earlier.

## A worked loop

```text
open_gates_lease           → lease the next case; get { gate, events, state, lease.token }
read state.checks          → the cross_check is usually decisive (claim vs. the reference)
open_gates_decide          → { id, outcome, acceptedValues?, note, leaseToken }  (role from scope)
```

A concrete construction case: claim `120 m³`; the independent survey reads
`117 m³ ± 4 (k=2)`. The error is `|120 − 117| = 3 m³ = 2.56%` of the reference —
inside the 5% tolerance **and** inside `U` — so the rule accepts **117, not 120**,
and money is paid on the accepted quantity: gross `117 × €85 = €9,945`, net
`€9,447.75`. Had the survey read `100 m³` (20% of the reference), the blocking
cross-check fails and the engine refuses any positive outcome.

## See also

- [Review queue](REVIEW-QUEUE.md) — the queue's leases, SLA, delegation trail, stores, and OAuth.
- [`packages/engine/src/mcp/`](../packages/engine/src/mcp/) — the stdio server, the JSON-RPC dispatcher, the tool surface, and the HTTP client.
