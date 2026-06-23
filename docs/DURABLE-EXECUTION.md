# Durable execution: where Open Gates fits

> Why not just write a Temporal activity? Because Open Gates is event sourcing for **one decision** — the moment a claim becomes a payable fact — not a runtime. It has no scheduler, no retry loop, no timers. It pairs with your orchestrator; it does not replace it.

Durable-execution engines — Temporal, Inngest, Restate, DBOS, Vercel Workflows — already solve the hard runtime problems: retries, backoff, timers, signals, fan-out, and at-least-once step execution that survives a crash. Open Gates does not re-solve any of that. It contributes a typed acceptance contract, the invariants around it, and a deterministic fold whose replay is over **data, not code**.

## Who owns what

| Concern | Orchestrator (Temporal / Inngest / Restate / …) | Open Gates |
| --- | --- | --- |
| Retries, backoff, timeouts | yes | no |
| Timers, signals, sleep-until | yes | no |
| Fan-out / parallelism | yes | no |
| At-least-once step execution | yes | no |
| I/O: measure, fetch evidence, `pay()` | yes (inside a step) | no |
| The acceptance contract (claim → checks → decision → effects) | no | yes — [`types.ts`](../engine/src/types.ts) |
| Invariants: role-gating, blocking checks must gate a positive outcome | no | yes — [`fold.ts`](../engine/src/fold.ts) |
| Deterministic replay of the decision from its event log | no | yes — `fold(gate, events)` |
| Audit trail + dataset label | no | yes — `GateState.log`, `datasetLabel` |
| Exactly-once effect identity | shared: you deliver; OG assigns the key | `effectId` — [`effects.ts`](../engine/src/effects.ts) |

The seam is clean: the orchestrator owns *when and how often* work runs; Open Gates owns *what counts as accepted*.

## The rule of thumb

**Wrap I/O in a step. Never wrap `fold`.**

`fold(gate, events)` reads no `Date.now()`, no `Math.random()`, no env; it dedups events by `id` and requires `seq === state.seq + 1` (SPEC [§3](../SPEC.md#3-state-lifecycle-and-the-determinism-contract)). Those properties are why a worker can recompute the exact same `GateState` from the same log forever — and why two replicas replaying the same events never disagree. Wrap it in a step and you'd be checkpointing a value the orchestrator can already reproduce for free, while inviting a non-deterministic dependency to leak in. Steps are for the things that *can't* be replayed: the survey reading, the bank call.

## Example (Inngest)

```ts
import { inngest } from "./client";
import { fold, pending, deliver } from "@open-gates/engine";
import { gate, outbox, send } from "./wiring";

export const acceptDelivery = inngest.createFunction(
  { id: "accept-delivery" },
  { event: "claim/submitted" },
  async ({ event, step }) => {
    // I/O → step.run: retried, backed off, checkpointed by Inngest.
    const surveyed = await step.run("measure", () =>
      survey(event.data.caseId)        // e.g. 117 m³, U=4 (k=2)
    );

    const reviewed = await step.run("review", () =>
      requestDecision(event.data.caseId, surveyed)
    );

    // The decision: PURE. No step.run. Just data in, GateState out.
    // Replaying these events on any worker yields the identical state.
    const state = fold(gate, [
      ...event.data.log,
      { id: `${event.data.caseId}#${surveyed.seq}`, seq: surveyed.seq,
        type: "evidence.attached", evidence: surveyed },
      { id: `${event.data.caseId}#${reviewed.seq}`, seq: reviewed.seq,
        type: "decision.recorded", reviewerRole: reviewed.role,
        outcome: reviewed.outcome, acceptedValues: reviewed.acceptedValues },
    ]);

    // Effects back to I/O. Each carries effectId = sha256(decisionEventId+':'+ruleId)[:16].
    // pay() MUST be idempotent on effectId, because the step is at-least-once.
    await step.run("fire-effects", () =>
      deliver(outbox, pending(outbox, state.consequences), (effect) =>
        send(effect)                    // send → pay(effect.effectId, amount)
      )
    );

    return state.decision;             // e.g. accepted 117 → net €9,447.75
  }
);
```

Restate, Temporal, and DBOS map the same way: their step/activity/transaction primitive wraps `measure`, `review`, and `fire-effects`; `fold` runs inline between them.

## Why this division holds

- **Replay is over data.** The orchestrator replays your *workflow code* to rebuild progress and may run a step's body more than once. Open Gates replays the *event log* to rebuild the decision and runs `fold` as a pure function. Different replay models, composed — keep them from contaminating each other and both stay correct.
- **At-least-once meets exactly-once at `effectId`.** Because steps can re-run, `deliver()` skips any `effectId` already in the outbox, and `pay()` must be idempotent on it. The orchestrator guarantees the effect step *eventually* runs; the `effectId` guarantees the money moves *once*. On the canonical line that is `117 × €85` paid one time, never `120`, never twice.
- **One job each.** Notifications out of the queue are at-most-once, best-effort — the queue (and this log) is the source of truth; poll to reconcile. Durability of *delivery* is the orchestrator's job. Correctness of *the decision* is ours.

See also: [`effects.ts`](../engine/src/effects.ts) (outbox, exactly-once), [`fold.ts`](../engine/src/fold.ts) (the pure reducer), and SPEC [§3](../SPEC.md#3-state-lifecycle-and-the-determinism-contract) / [§6.1](../SPEC.md#61-money-normative).
