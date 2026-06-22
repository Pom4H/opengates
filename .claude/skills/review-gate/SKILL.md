---
name: review-gate
description: Pull the next pending Open Gates case from a review queue, examine the claim, evidence and check results, and record a decision. Use when asked to review, triage, or clear acceptance cases.
allowed-tools: Bash, Read
---

# Review Gate

You are a **reviewer harness** for an Open Gates review queue. The queue holds
*cases*: a contractor/driver/supplier asserted a fact (a claim), evidence is
attached, and a decision is needed. Your job is to pull a case, judge it, and
record a decision the engine folds into an accepted (or rejected) fact.

The queue is a plain HTTP service. Set `OPEN_GATES_URL` (default
`http://localhost:3000`). All bodies are JSON.

## The loop

1. **Pull** the next pending case (optionally scope by `inbox`, `role`, or
   `domain` — e.g. to work one team's inbox):

   ```bash
   curl -s -X POST "$OPEN_GATES_URL/queue/lease" \
     -H 'content-type: application/json' \
     -d '{"holder":"claude","inbox":"supervisors","role":"technical_supervisor"}'
   ```

   A `204` (empty) means nothing is waiting — stop. Otherwise you get an item
   with `gate`, `events`, `state`, `allowedDecisions`, and `lease.token`.

2. **Judge.** Read `state.checks` (each `pass`/`fail`/`skipped`), the `claim`
   values, and the attached `evidence`. The decisive rule is usually the
   `cross_check` (claim vs. reality within a tolerance). Decide an outcome from
   `allowedDecisions` only.

3. **Decide**, echoing the `lease.token` and using the gate's `reviewer.role`:

   ```bash
   curl -s -X POST "$OPEN_GATES_URL/queue/<id>/decision" \
     -H 'content-type: application/json' \
     -d '{"outcome":"accepted","reviewerRole":"technical_supervisor","actor":"claude","leaseToken":"<token>","note":"why"}'
   ```

4. Repeat until the lease returns `204`.

## Rules the engine enforces (so honor them)

- A **positive** outcome (`accepted`, `accepted_with_exceptions`) requires every
  **blocking** check to pass. If they don't, the API returns **422** — choose
  `returned_for_rework` or `rejected` instead, or release the case
  (`POST /queue/<id>/release`) so evidence can be added.
- Only the gate's `reviewer.role` may decide; any other role is refused (422).
- Put your reasoning in `note` — it is recorded in the audit trail and the
  dataset label.

## When unsure

If the evidence is insufficient to judge, do **not** force an acceptance.
Prefer `returned_for_rework` with a note on what is missing, or release the
lease. Never invent evidence.
