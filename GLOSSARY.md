# Glossary

Vocabulary for Open Gates. Each entry names the concept, what it means in the model, and where it lives in the code. See [SPEC.md](SPEC.md) for the normative event and state shapes.

---

## Acceptance Act

The bounded moment a submitted claim becomes an accepted, payable fact: checked against a trusted reference, decided by a proven authority, with effects that fire exactly once from a log that replays to the same state forever. It is the one thing Open Gates owns. Everything else in this glossary is a part of it.

The Act has eight elements. The engine has one term for each. This is the only canonical mapping; the rest of the glossary expands the right-hand column.

| Acceptance-Act element | What it answers | Engine term |
| --- | --- | --- |
| **Context** | Which decision is this, and under what rules? | gate metadata (gate definition: tolerance, rate, SLA, automation policy) |
| **Subject** | What is being claimed? | `claim` (e.g. `claim.submitted` of 120 m³) |
| **Grounds** | What independent facts support it? | `evidence[]` (`evidence.attached`, e.g. a 117 m³ survey) |
| **Criteria** | How is the claim tested against the grounds? | `checks[]` — a decision table run by the engine |
| **Authority** | Who is permitted to decide? | `reviewer` — the proven role on the `decision.recorded` event |
| **Decision** | Accept / accept-with-exceptions / return? | `decision` + `responsibility` on the state |
| **Effect** | What happens as a result? | `consequences: FiredEffect[]` (e.g. certify net, notify) |
| **Record** | What is the durable, replayable account? | the event `log[]` that `fold` replays into state |

The bridge in one line: **`fold(gate, events) → GateState`**. Data in, decided fact out, deterministically.

---

## gate

The unit of decision: one bounded acceptance question (e.g. "is this hidden-works claim acceptable and payable?"). A gate is not a workflow or a stage in one. It owns a single decision and integrates with whatever orchestrates the work around it. Open Gates owns the gate; it does not own the project.

## gate definition

The static configuration of a gate — its metadata, separate from any case running through it. Holds the reference/cross-check spec, `tolerance`, the rate and money terms (rate, `retentionPct`, `retentionCap`, `vatRate`, payment terms), the `sla` block, and the `autoAcceptWhen` automation policy. Example: [`examples/construction/gate.json`](examples/construction/gate.json). Loaded by `loadGate`.

## gate case

One instance of a gate in flight: a specific claim with its own event log, evidence, and eventual decision. A case is the thing a reviewer leases and decides; in the queue it is the item whose per-case event log is the record. Scenarios in [`examples/construction/`](examples/construction/) (`scenario.accept.json`, `scenario.dispute.json`, `scenario.remarks.json`) are gate cases.

## claim

The asserted fact awaiting acceptance — what someone says is true and wants paid on. Recorded by the `claim.submitted` event. In the construction example the claim is 120 m³ of hidden works. A claim is not yet a fact; the Act is what (maybe) makes it one. In W3C [PROV-O](https://www.w3.org/TR/prov-o/) terms `claim.submitted` is a `prov:Entity`.

## evidence

Independent grounds attached to a case to test the claim. Recorded by `evidence.attached` and held in `evidence[]`. In the example, an independent survey reading of 117 m³ from a Leica TS16 with calibration on file. Evidence is *used by* the decision activity (`prov:used`); it is not the claim and does not by itself decide anything.

## reference

The trusted value the claim is measured against — the survey reading, the catalogue quantity, the contracted window. The engine pays on the **accepted** quantity, and the reference is what makes a value acceptable: money flows on `decision.acceptedValues` → the surveyed reference → (only as a last resort) the claim. Accepting 117 m³ instead of the claimed 120 m³ is the reference winning.

## cross_check

A check that compares the claim to the reference and to its measurement uncertainty. The core construction cross-check: `|claim − reference|` against both a percentage `tolerance` and the expanded uncertainty `U`. `|120 − 117| = 3 m³ = 2.56%` of the reference — inside the 5% tolerance **and** inside `U = 4 m³` → accept 117. The dispute case: `|120 − 100| = 20 m³ = 20%`, far outside both → return for rework, €0 certified. Defined in [`packages/engine/src/checks.ts`](packages/engine/src/checks.ts).

## tolerance

The allowed deviation between claim and reference, as a fraction of the reference, set in the gate definition. Construction tolerance is 5%. It is one of the two bars a cross-check must clear; the other is `U`. A deviation can sit inside the percentage tolerance yet still fail if it exceeds the measurement uncertainty, and vice versa.

## expanded uncertainty (U, k)

The measurement's stated doubt, per JCGM 100:2008 (GUM): `U = k · u`, where `u` is the combined standard uncertainty and `k` is the coverage factor. The survey reports `U = 4 m³` at `k = 2` (~95% coverage). The error of the claim against the reference (JCGM 200:2012, VIM §2.16) must fall within `U` for the values to be treated as agreeing: `3 m³ < 4 m³` agrees; `20 m³ > 4 m³` does not.

## check

A single rule in the gate's decision table (OMG DMN 1.4, 2022): a named, deterministic test producing pass/fail. Checks live in `checks[]`; `checksPassed` is true only when every blocking check passes. Some checks block a positive outcome (a delivery `date_window` outside its bounds; a failed cross-check); the engine refuses to let a decision certify money over a failed blocking check. See [`packages/engine/src/checks.ts`](packages/engine/src/checks.ts).

## reviewer (authority)

The agent permitted to decide this gate, identified by a **proven** role — never a self-asserted one. The role comes from the verified token's scope (`authorizedRole`, [`packages/engine/src/auth.ts`](packages/engine/src/auth.ts)), or from the MCP caller's Principal — not from the request body. On `decision.recorded` it is `reviewerRole`; in PROV-O the reviewer is the `prov:Agent` the decision activity `prov:wasAssociatedWith`. No proven authority, no decision: the gate refuses.

## decision

The recorded outcome of the Act: `accepted`, `accepted_with_exceptions`, or `returned_for_rework`, written by `decision.recorded {reviewerRole, outcome, acceptedValues?, note?}` and surfaced as `decision` on the state. The accepted quantity drives money. Worked outcomes: accept 117 → net certified €9,447.75; accept-with-exceptions 118 → net €9,528.50 with retention held against the punch list; return on survey 100 → €0 certified.

## responsibility

Who owns the decided fact and any open obligations it carries — the durable answer to "on whose authority, and with what still outstanding". Carried on the state as `responsibility`, derived from the proven reviewer and the outcome (e.g. an accept-with-exceptions leaves the punch-list obligation attached). Distinct from the queue's `assignment` trail, which records routing rather than the accepted fact.

## consequence

An effect that fires because of the decision: certify net, post earned value, notify, escalate. Held on the state as `consequences: FiredEffect[]` and produced by [`packages/engine/src/consequences.ts`](packages/engine/src/consequences.ts) / `fireConsequences(...)`. Money certified on the accepted quantity is the load-bearing consequence; accepted_qty × rate is BCWP under ANSI/EIA-748 (EVM). Consequences are computed from the decided state, not invented per request.

## effectId

The exactly-once key for a consequence: `sha256(decisionEventId + ':' + ruleId)` sliced to 16 hex. Two replays of the same decision produce the same `effectId`, so the outbox in [`packages/engine/src/effects.ts`](packages/engine/src/effects.ts) — `createOutbox`, `pending`, `deliver` — delivers each effect at most once and any downstream `pay()` keyed on `effectId` is idempotent. This is where "fires exactly once" is real rather than aspirational.

## fold

The pure function at the center: `fold(gate, events) → GateState`. Deterministic and idempotent — it dedups events by `id`, requires `seq === state.seq + 1`, and reads no `Date.now()`, `Math.random()`, or environment. The same events always fold to the same state, on any machine, forever; that is why replay is replay of **data**, not of code. Property-tested in [`packages/engine/test/fold.test.ts`](packages/engine/test/fold.test.ts). Defined in [`packages/engine/src/fold.ts`](packages/engine/src/fold.ts). Never wrap `fold` in an orchestrator step — it must stay pure so every replayer reproduces it identically.

## event

An immutable, persisted fact in a case's log. Three kinds: `claim.submitted`, `evidence.attached`, `decision.recorded`. Every persisted event carries an `id` and a `seq`. `normalizeLog(caseId, events)` assigns `seq = i + 1` and `id = ${caseId}#${seq}`. In PROV-O the log is a `prov:Bundle`. Events are appended, never edited.

## seq

The monotonic sequence number on each event, starting at 1. `fold` requires the next event to satisfy `seq === state.seq + 1`, so gaps and reorderings are rejected rather than silently absorbed. `seq` is what makes the log a totally-ordered record and the fold a strict replay.

## state

`GateState` — the decided fact produced by folding a case's log. Fields: `gateId`, `status`, `seq`, `seenIds[]`, `claim`, `evidence[]`, `checks[]`, `checksPassed`, `decision`, `responsibility`, `consequences`, `datasetLabel`, `submittedAt`, `decidedAt`, `cycleDays`, `log[]`. State is never stored as the source of truth — it is always recomputable from the log. The accept example yields `cycleDays = 2.25`.

## dataset label

The outcome stamped onto a case for evaluation: the accept/exceptions/return label that turns a stream of real decisions into a labeled dataset (`datasetLabel` on the state; JSONL such as [`examples/construction/dataset.sample.jsonl`](examples/construction/dataset.sample.jsonl)). Running the automation policy over the labeled set yields coverage, agreement, and false-accept rate — for the sample: coverage 0.5, agreement 1.0, falseAcceptRate 0.

## automation policy

The gate's rule for deciding without a human: `autoAcceptWhen`. The construction policy is `maxAmount = €2,000 NET` — auto-accept only when the certified net is at or below the bar, every blocking check passes, and the cross-check agrees. The bar is a risk-adjusted break-even: `manual_review_cost / (auto_error_rate × avg_overpayment_fraction)` = `€12 / (0.01 × 0.10)` = €12,000 gross, floored to €2,000. Evaluated by `autodecide(gate, state, now)` — `now` is required; the policy reads no wall clock.

## lease & fencing token

A lease is the right to decide a case, held by one reviewer at a time. Each lease carries a monotonic `{ token, fence }`. Deciding a leased case requires the lease token (else `409 'case is leased; a lease token is required'`); a token that was valid before a re-lease is rejected (`409 'stale lease'`), so a resurrected old holder is fenced out and cannot double-decide. Leases and fencing live in [`packages/engine/src/queue/queue.ts`](packages/engine/src/queue/queue.ts) (`createReviewQueue`).

## SLA breach / escalation

The queue's time discipline. A gate's `sla = { reviewWithinHours, priority, escalateToInbox }` sets `dueAt = enqueuedAt + reviewWithinHours` at enqueue. `reap()` flips any overdue, still-undecided case to **breached** and appends an immutable `{kind:'escalate', by:'system:sla'}` assignment routing it to the escalation inbox. Lease order then puts breached cases first, then by priority, then soonest `dueAt`, then FIFO. The logistics gate runs a 24h SLA at `high` priority escalating to `goods-in-escalation`. Notifications about all this are at-most-once and best-effort — the queue is the source of truth; poll to reconcile.

## zone

A place in a 3D model of the operation that a claim is **anchored** to — e.g. one block of a building (*section × row × floor*, id like `A1-F03`). A claim field of kind `zone`, its format validated by a `field_pattern` check. A zone is an *anchor*: many works (cases) and documents (evidence) accrue to it over time, so it becomes the place you inspect to see everything that happened there. Non-normative (an engine may ignore zones and still conform). See [`viz/`](viz/README.md) and SPEC §7.5.

## indexByZone / lintZones

The inversion of the claim→zone link. `indexByZone(states)` returns, per zone, its `works` (status + accepted money), `documents` (evidence refs), and an acceptance `rollup` — the exact shape the 3D selector reads from `viz/model/attachments.json`. `lintZones(states, model)` flags what a single in-case check can't see: `unknown_zone` (a zone absent from the model) and `duplicate_acceptance` (the same zone + system accepted twice). In [`packages/engine/src/zones.ts`](packages/engine/src/zones.ts).

## operations layer

What Open Gates is in one frame: a way to **see and control the operations of a business**, one accepted fact at a time. The operational map (and any product) is built **on** the Acceptance Act standard — not a replacement for an ERP, a workflow engine, or a BPM tool, but the verifiable acceptance boundary underneath them.
