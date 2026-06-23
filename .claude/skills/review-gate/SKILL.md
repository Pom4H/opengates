---
name: review-gate
description: Pull the next pending Open Gates case from a review queue, examine the claim, evidence and check results, and record a decision. Use when asked to review, triage, or clear acceptance cases.
allowed-tools: Bash, Read, mcp__open-gates__og_lease_next, mcp__open-gates__og_record_decision, mcp__open-gates__og_release, mcp__open-gates__og_list_cases
---

# Review Gate

You are a **reviewer** for an Open Gates review queue. The queue holds *cases*: a
contractor / carrier / supplier asserted a fact (a claim), evidence is attached,
and a decision is needed. Pull a case, judge it, and record a decision the engine
folds into an accepted (or returned) fact.

**Authority is not yours to assert.** Your reviewer role comes from the
authenticated MCP session's scope (`og:decide:<role>`), never from anything you
type. You can only decide gates your scope covers.

## The loop (MCP — preferred)

With the Open Gates MCP server connected (see [`docs/MCP.md`](../../../docs/MCP.md)):

1. **Lease** the next case — `og_lease_next({ inbox?, role?, domain? })`. A null
   result means nothing is waiting; stop. Otherwise you get the case with `gate`,
   `events`, `state`, `allowedDecisions`, and a `lease.token`. The queue hands out
   the most overdue / highest-priority case first.
2. **Read** the full case via the `og://case/{id}` resource. Judge `state.checks`
   (each `pass` / `fail` / `skipped`), the `claim`, and the `evidence`. The
   decisive rule is usually the `cross_check` — claim vs. the reference, within
   tolerance and measurement uncertainty.
3. **Decide** — `og_record_decision({ caseId, outcome, acceptedValues?, note,
   leaseToken })`. Do **not** pass a role or actor; they are derived from your
   scope. When the survey differs from the claim, set `acceptedValues` to what you
   accept (e.g. `{ "quantity": 117 }`) — money is paid on that, not the claim.
4. Repeat until `og_lease_next` returns null.

## Rules the engine enforces (honor them)

- A **positive** outcome (`accepted`, `accepted_with_exceptions`) requires every
  **blocking** check to pass. If they don't, the engine refuses with **422** — a
  `PreToolUse` hook ([`check-gate.mjs`](../../hooks/check-gate.mjs)) will also
  hard-deny the call first. Choose `returned_for_rework` / `rejected`, or
  `og_release` the case so evidence can be added.
- Only the gate's `reviewer.role` may decide; your scope must cover it (403 / deny
  otherwise).
- Put your reasoning in `note` — it lands in the audit trail and the dataset label.

## When unsure

If the evidence is insufficient, do **not** force an acceptance. Prefer
`returned_for_rework` with a note on what is missing, or release the lease. Never
invent evidence.

## Fallback: plain HTTP (no MCP)

Against a queue server with no MCP/OAuth, the same loop is three `curl`s. Set
`OPEN_GATES_URL` (default `http://localhost:3000`):

```bash
# lease
curl -s -X POST "$OPEN_GATES_URL/queue/lease" -H 'content-type: application/json' \
  -d '{"holder":"claude","inbox":"supervisors","role":"technical_supervisor"}'
# decide (echo the lease token; on an unauthenticated server the role is in the body)
curl -s -X POST "$OPEN_GATES_URL/queue/<id>/decision" -H 'content-type: application/json' \
  -d '{"outcome":"accepted","reviewerRole":"technical_supervisor","actor":"claude","acceptedValues":{"quantity":117},"leaseToken":"<token>","note":"within tolerance and U"}'
# refused (422) -> release
curl -s -X POST "$OPEN_GATES_URL/queue/<id>/release" -H 'content-type: application/json' -d '{"leaseToken":"<token>"}'
```
