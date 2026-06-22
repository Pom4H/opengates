# MCP server — native Claude review

> Part of [Level 5](../README.md#whats-in-this-repository). An [MCP](https://modelcontextprotocol.io)
> wrapper around the review queue, so Claude (or any MCP client) can work cases
> as **tools** — lease → judge → decide — instead of hand-building `curl` calls
> and lease tokens.

## What it is

[`engine/src/mcp/server.ts`](../engine/src/mcp/server.ts) is a small,
**dependency-free** MCP server (its own JSON-RPC over stdio — no SDK, in keeping
with the rest of the repo). It is a thin **client** of a running review queue
(the [Docker / `server.ts`](REVIEW-QUEUE.md) deployment), so the queue stays the
single source of truth: leases, the delegation trail and persistence all live
there. The MCP server adds no state of its own.

It exposes seven tools:

| Tool | Maps to | Purpose |
|------|---------|---------|
| `open_gates_lease` | `POST /queue/lease` | Pull the next pending case (filter by inbox/role/domain) |
| `open_gates_get` | `GET /queue/:id` | Fetch one case + its delegation trail |
| `open_gates_list` | `GET /queue` | List cases (by status/domain/inbox/assignee) |
| `open_gates_decide` | `POST /queue/:id/decision` | Record a decision (engine folds it in) |
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
# env: OPEN_GATES_URL (http://localhost:3000), OPEN_GATES_TOKEN (optional bearer)
```

It speaks JSON-RPC on stdin/stdout; diagnostics go to stderr. You normally don't
run it by hand — an MCP client launches it.

## Register with Claude Code

```bash
claude mcp add open-gates \
  --env OPEN_GATES_URL=http://localhost:3000 \
  -- node /absolute/path/to/opengates/engine/src/mcp/server.ts
```

Or add it to a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "open-gates": {
      "command": "node",
      "args": ["engine/src/mcp/server.ts"],
      "env": {
        "OPEN_GATES_URL": "http://localhost:3000"
      }
    }
  }
}
```

Then just ask Claude to *"review the next Open Gates case."* It will lease a
case, read the checks/claim/evidence, and decide — the same loop the
[`/review-gate` skill](../.claude/skills/review-gate/SKILL.md) drives over curl,
now as first-class tools. The skill and the MCP server are two transports for
one contract; pick whichever your harness prefers.

> Auth: if the queue runs with `OPEN_GATES_SECRET` set, give the MCP server an
> `OPEN_GATES_TOKEN` and it is forwarded as a bearer credential on every call.
