---
name: review-gate
description: Pull the next pending Open Gates case from a review queue, examine the claim, evidence and check results, and record a decision. Use when asked to review, triage, or clear acceptance cases.
allowed-tools: Bash, Read, mcp__open-gates__open_gates_lease, mcp__open-gates__open_gates_get, mcp__open-gates__open_gates_list, mcp__open-gates__open_gates_decide, mcp__open-gates__open_gates_release
---

# Review Gate

You are a **reviewer** for an Open Gates review queue. The queue holds *cases*: a
contractor / carrier / supplier asserted a fact (a claim), evidence is attached,
and a decision is needed. Pull a case, judge it, and record a decision the engine
folds into an accepted (or returned) fact.

**Identity.** Your reviewer role is **proven, not asserted**. When the deployment
runs with OAuth on, it derives the role and actor from your token's scope
(`og:decide:<role>`), ignoring anything you type. You can only decide gates your
scope covers; a `403` means it does not.

## The loop (MCP — preferred)

With the Open Gates MCP server connected (see [`docs/MCP.md`](../../../docs/MCP.md)):

1. **Lease** — `open_gates_lease({ inbox?, role?, domain? })`. A "nothing pending"
   note means stop. Otherwise you get the case (`gate`, `events`, `state`,
   `allowedDecisions`, `lease.token`); the queue hands out the most overdue /
   highest-priority case first.
2. **Judge** — read `state.checks` (each `pass` / `fail` / `skipped`), the
   `claim`, and the `evidence`. The decisive rule is usually the `cross_check`:
   claim vs. the reference, within tolerance and measurement uncertainty. Decide
   an outcome from `allowedDecisions` only.
3. **Decide** — `open_gates_decide({ id, outcome, acceptedValues?, note,
   leaseToken })`. When the survey differs from the claim, set `acceptedValues`
   to what you accept (e.g. `{ "quantity": 117 }`) — money is paid on that, not
   the claim. Put your reasoning in `note`; it lands in the audit trail and the
   dataset label.
4. Repeat until `open_gates_lease` returns nothing.

## Rules the engine enforces (honor them)

- A **positive** outcome (`accepted`, `accepted_with_exceptions`) requires every
  **blocking** check to pass. If they don't, the engine refuses with **422** — and
  a `PreToolUse` hook ([`check-gate.mjs`](../../hooks/check-gate.mjs)) hard-denies
  the call first. Choose `returned_for_rework` / `rejected`, or `open_gates_release`
  the case so evidence can be added.
- Only the gate's `reviewer.role` may decide; your scope must cover it.

## When unsure

If the evidence is insufficient, do **not** force an acceptance. Prefer
`returned_for_rework` with a note on what is missing, or release the lease. Never
invent evidence.

## Fallback: plain HTTP (no MCP)

Against a queue with no MCP, the same loop is three `curl`s. Set `OPEN_GATES_URL`
(default `http://localhost:3000`). If auth is on (`GET /` shows `"auth":
"oauth2.1"`), send `-H "authorization: Bearer $OPEN_GATES_TOKEN"` on each call —
mint a token with `OG_JWT_SECRET=… npm run token -- --actor you --role <role>`.

```bash
# lease
curl -s -X POST "$OPEN_GATES_URL/queue/lease" -H 'content-type: application/json' \
  -H "authorization: Bearer $OPEN_GATES_TOKEN" \
  -d '{"holder":"claude","inbox":"supervisors","role":"technical_supervisor"}'
# decide (echo the lease token; with auth on, role+actor come from the token)
curl -s -X POST "$OPEN_GATES_URL/queue/<id>/decision" -H 'content-type: application/json' \
  -H "authorization: Bearer $OPEN_GATES_TOKEN" \
  -d '{"outcome":"accepted","acceptedValues":{"quantity":117},"leaseToken":"<token>","note":"within tolerance and U"}'
# refused (422) -> release
curl -s -X POST "$OPEN_GATES_URL/queue/<id>/release" -H 'content-type: application/json' -d '{"leaseToken":"<token>"}'
```
