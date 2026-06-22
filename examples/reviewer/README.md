# Reviewer harnesses

A *reviewer* pulls cases off the [review queue](../../docs/REVIEW-QUEUE.md),
judges them, and records a decision. The queue is harness-agnostic — anything
that speaks HTTP can review. Two reference harnesses live here:

| Harness | What it is | Where |
|---------|------------|-------|
| **Claude skill** | A `/review-gate` skill that drives the pull → judge → decide loop with Claude's judgment. | [`.claude/skills/review-gate/SKILL.md`](../../.claude/skills/review-gate/SKILL.md) |
| **Polling script** | A dependency-free Node script showing the same contract; swap `review()` for your own logic. | [`poll.mjs`](poll.mjs) |

## The contract (any harness)

```text
POST /queue/lease            -> lease the next pending case (204 = none waiting)
   read item.state.checks, item.claim, item.evidence, item.allowedDecisions
POST /queue/:id/decision     -> record { outcome, reviewerRole, actor, leaseToken, note }
POST /queue/:id/release      -> hand it back undecided (e.g. need more evidence)
```

The engine enforces the invariants: only the gate's `reviewer.role` may decide,
and a positive outcome (`accepted` / `accepted_with_exceptions`) requires all
**blocking** checks to pass — otherwise the decision is refused with `422`.

## Run the polling harness

```bash
# point it at a running queue (see docs/REVIEW-QUEUE.md to start one)
OPEN_GATES_URL=http://localhost:3000 node examples/reviewer/poll.mjs
```
