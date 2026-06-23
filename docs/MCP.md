# Driving Open Gates from an agent (MCP)

> Level 5 of the [ladder](../README.md#whats-in-this-repository). The MCP server exposes the acceptance-gate lifecycle as typed tools and resources, backed by the same [`ReviewQueue`](../engine/src/queue/queue.ts) the HTTP server uses. An agent leases a case, reads its state, judges the checks, and records a decision — under the same role-gating as a human reviewer.

The engine stays dependency-free. The MCP SDK and `zod` are real dependencies and live **only** under [`mcp/`](../mcp/), so [`engine/src`](../engine/src) stays type-strippable. Install them once before running:

```bash
cd mcp && npm install && npm run mcp
```

## Connecting

### Local — stdio

For a local agent (e.g. Claude Code), run the server over stdio. Drop this in `.mcp.json`:

```json
{
  "mcpServers": {
    "open-gates": {
      "command": "node",
      "args": ["mcp/server.ts"],
      "env": { "QUEUE_FILE": "./data/queue.json" }
    }
  }
}
```

The queue is a file on disk ([`createFileStore`](../engine/src/queue/store.ts)); `QUEUE_FILE` points at it. In stdio mode the caller's authority comes from the environment (`OG_SCOPES`, `OG_ACTOR`) — there is no token to verify locally.

### Remote — Streamable HTTP behind OAuth 2.1

For a shared queue, mount the same tools behind a remote Streamable HTTP transport guarded by OAuth 2.1:

```json
{
  "mcpServers": {
    "open-gates": { "url": "https://gates.example.com/mcp" }
  }
}
```

Here the caller's authority comes from the verified OAuth token, not the environment. See [Authority](#authority-is-not-an-argument) below.

## Tools

[`mcp/tools.ts`](../mcp/tools.ts). Two are pure functions over data; the rest drive a queue.

| Tool | What it does |
| --- | --- |
| `og_fold` | Fold an event log to a `GateState` — pure, deterministic, idempotent. No queue. |
| `og_autodecide` | Run the gate's automation rule against a state at an explicit `now`. No queue. |
| `og_enqueue` | Submit a claim as a new case into the queue. |
| `og_attach_evidence` | Attach an evidence event (e.g. a survey + uncertainty) to a case. |
| `og_lease_next` | Lease the next due case under a fencing lease; returns the case and a lease token. |
| `og_record_decision` | Record `decision.recorded` on a leased case. Outcome derives the consequences. |
| `og_release` | Release a lease without deciding. |
| `og_list_cases` | List cases (filter by status / inbox). |

### Resources

| URI | Contents |
| --- | --- |
| `og://case/{id}` | The current folded `GateState` for a case. |
| `og://case/{id}/events` | The raw, ordered event log (the record). |
| `og://dataset/{name}` | JSONL examples with labels — see [`examples/`](../examples/). |

See [`mcp/resources.ts`](../mcp/resources.ts).

## Authority is not an argument

`og_record_decision` does **not** take `reviewerRole` or `actor`. Both are derived from the caller's verified scope, never the input — so an agent cannot vote itself a role it has not proven.

- **stdio** — the role comes from `OG_SCOPES` / `OG_ACTOR` in the environment.
- **remote** — the role comes from the OAuth token, resolved to a `Principal` by [`engine/src/auth.ts`](../engine/src/auth.ts).

### Scopes

A `Principal` carries `scopes[]`. The gate role is proven by `og:decide:<role>` (or the wildcard `og:decide:*`); the queue verbs are guarded by `og:read`, `og:enqueue`, `og:lease`.

| Scope | Grants |
| --- | --- |
| `og:read` | Read cases and resources (`og_list_cases`, `og://…`). |
| `og:enqueue` | Submit claims and evidence. |
| `og:lease` | Lease and release cases. |
| `og:decide:<role>` | Record a decision **as `<role>`** — the role the engine writes is the one it proves, not one the body asserts. |

`authorizedRole(principal, gateRole)` returns the proven role or `403`; `requireScope(principal, scope)` guards the read/enqueue/lease verbs.

### The OAuth flow (remote)

The resource advertises its authorization server per **RFC 9728**:

```http
GET /.well-known/oauth-protected-resource
```

A missing or invalid token yields `401` with a pointer back to that metadata:

```http
WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"
```

The verifier is dependency-free HS256, or a pluggable `verify` hook for RS256/JWKS. Audience binding follows **RFC 8707**. The remote `/queue/:id/decision` route derives `reviewerRole` and `actor` from the token, never the body, and honors an `Idempotency-Key` header. Auth turns on when `OG_JWT_SECRET` is set (with `OG_RESOURCE_URI`, `OG_ISSUER`). The server **generates** the PRM dynamically from those values; [`.well-known/oauth-protected-resource.json`](../.well-known/oauth-protected-resource.json) is a sample document showing the shape (its `resource` / `authorization_servers` are placeholders, and it lists per-role `og:decide:<role>` scopes a deployment may advertise). See [`engine/src/auth.ts`](../engine/src/auth.ts).

## Hooks: invariants the agent cannot skip

[`.claude/hooks/hooks.json`](../.claude/hooks/hooks.json) wires two hooks around `og_record_decision`:

- **PreToolUse** → [`check-gate.mjs`](../.claude/hooks/check-gate.mjs) hard-**denies** a positive outcome when `state.checksPassed` is `false` (it asks the engine at `OPEN_GATES_URL`). A blocking check that failed cannot be waved through.
- **PostToolUse** → [`audit-append.mjs`](../.claude/hooks/audit-append.mjs) appends the decision to `.claude/decisions.jsonl`.

The engine already refuses a positive decision when a blocking check failed; the hook denies it one layer earlier, before the call lands.

## A worked loop

```text
og_lease_next            → lease the next due case; get { case, leaseToken }
read og://case/{id}      → fold the events to a GateState
judge state.checks       → blocking checks passed? checksPassed === true?
og_record_decision       → outcome, acceptedValues?, note?  (role from scope)
```

A concrete construction case: the claim is `120 m³`; an independent survey reads `117 m³` with expanded uncertainty `U = 4 m³` (`k = 2`, ~95%, Leica TS16, calibration on file). The error against the reference is `|120 − 117| = 3 m³`, which is `2.56 %` of the reference (`3 / 117`) — inside the `5 %` tolerance **and** inside `U`. So the decision rule accepts **117, not 120**. Money is paid on the accepted quantity: gross `117 × €85 = €9,945`, retention `5 % = €497.25`, net certified `€9,447.75`.

Had the survey read `100 m³`, the error would be `20 m³` = `20 %` of the reference — far beyond both `U = 4` and the `5 %` limit. The gate returns `returned_for_rework`, `€0` certified. Paying the claim would have certified `120 × €85 = €10,200` against `100 × €85 = €8,500` supportable — a `€1,700` overclaim caught on one line.

Notifications from the queue are **at-most-once**, best-effort. The queue is the source of truth: poll [`og_list_cases`](#tools) to reconcile rather than trusting a webhook to have arrived.

## See also

- [Review queue](REVIEW-QUEUE.md) — the queue's leases, SLA, delegation trail, and stores.
- [`SPEC.md`](../SPEC.md) — the acceptance-act standard the tools implement.
- [`engine/src/queue/queue.ts`](../engine/src/queue/queue.ts) — the `ReviewQueue` behind every tool.
