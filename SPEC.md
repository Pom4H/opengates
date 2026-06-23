# Open Gates Specification (v0.2, draft)

> The normative description of the Acceptance Act. Machine-readable schemas live
> in [`spec/schema/`](spec/schema/); the language-agnostic conformance suite in
> [`conformance/`](conformance/); a non-normative reference implementation in
> [`packages/engine/`](packages/engine/).

A **gate** is a named decision point where a *claim* becomes an *accepted fact* —
or is refused — with real consequences. The spec separates two things:

- a **gate definition** — the reusable pattern (claim shape, evidence, checks,
  reviewer, decisions, consequences, optional SLA and policy);
- a **gate case** — one run, expressed as an append-only log of **events** that
  *fold* into a **state**.

```text
claim → evidence → checks → decision → consequences → dataset label
```

---

## 1. Gate definition

Schema: [`spec/schema/gate.schema.json`](spec/schema/gate.schema.json).

| Field | Meaning |
|-------|---------|
| `id`, `name`, `domain`, `description` | Identity and human framing. |
| `claim` | The asserted fact: a `type` and typed `fields`. |
| `evidence` | The grounds that may/must back the claim (`required` flag). |
| `checks` | Deterministic verification rules (§4). |
| `reviewer` | The `role` authorized to accept responsibility (§12). |
| `decisions` | Which outcomes this gate allows (subset of §5). |
| `consequences` | What each outcome releases (§6). |
| `sla` | Optional review SLA (§9 of [`docs/REVIEW-QUEUE.md`](docs/REVIEW-QUEUE.md)). |
| `policy` | Optional automation policy (§8). |

---

## 2. Events

Schema: [`spec/schema/event.schema.json`](spec/schema/event.schema.json).

A gate case is an **append-only log**. Every event carries:

- `id` — a stable, unique identifier (uuid/ULID). **Required on a persisted
  event**; the dedup key that makes replay idempotent. Hand-authored scenarios may
  omit it — `loadScenario()` derives `<gateRef>#<seq>` deterministically.
- `seq` — a monotonic per-case sequence; `apply()` requires `seq === state.seq + 1`.
- `at` — an ISO-8601 timestamp.
- `actor` — who emitted it.

| Event | Payload | Meaning |
|-------|---------|---------|
| `claim.submitted` | `claim` (type + values) | The fact is asserted. |
| `evidence.attached` | `evidence` (kind, values, ref) | Grounds are provided. |
| `decision.recorded` | `reviewerRole`, `outcome`, `acceptedValues?`, `note?` | A role accepts responsibility, recording the quantities actually accepted. |

Events are facts about what happened; they are never edited. To change an outcome
you append another event.

---

## 3. State, lifecycle, and the determinism contract

The engine *folds* the log into a single **state**: status, check results,
decision and responsibility, the effects fired, a dataset label, derived
cycle-time, and a human-readable log.

```text
 draft ──claim──▶ submitted ──claim+evidence──▶ under_review ──decision──▶
   accepted | accepted_with_exceptions | rejected | returned_for_rework
```

Rules the engine enforces:

- A **positive** outcome (`accepted`, `accepted_with_exceptions`) is valid only
  when every **blocking** check has passed; otherwise the decision is refused and
  the case stays `under_review`.
- Only the gate's `reviewer.role` may decide (§12); other roles are ignored.
- A positive outcome sets `responsibility` and fires `consequences` (§6).

**Determinism contract.** `fold(gate, events)` is a pure reduction that:

1. is **pure** — same log ⇒ identical state;
2. is **idempotent** — a redelivered event (same `id`) is a no-op; replaying the
   whole log changes nothing;
3. is **replayable** — it reads no `Date.now()`, `Math.random()`, or environment;
   every timestamp in the state comes from an event's `at`.

These are enforced by [`packages/engine/test/fold.test.ts`](packages/engine/test/fold.test.ts). They
are what let a gate be embedded as a deterministic step in a durable-execution
engine ([`docs/DURABLE-EXECUTION.md`](docs/DURABLE-EXECUTION.md)).

---

## 4. Checks

A check is a deterministic rule over the current claim + evidence. Each has an
`id`, optional `description`, and a `severity` of `blocking` (default) or
`warning`. Warnings never block acceptance.

| Rule | Parameters | Passes when |
|------|------------|-------------|
| `required_evidence` | `kinds[]` | every listed evidence kind is present |
| `field_present` | `field` | the claim field is set and non-empty |
| `field_range` | `field`, `min?`, `max?` | the numeric field is within range |
| `field_pattern` | `field`, `pattern` | the claim field is a string matching the regex `pattern` (used to validate a `zone` id — §7.5) |
| `date_window` | `field`, `start?`, `end?` | the date field falls within `[start, end]` |
| `cross_check` | `claimField`, `claimUnit?`, `evidenceKind`, `evidenceField`, `tolerance?`, `absolute?`, `uncertaintyField?`, `requireUnitMatch?` | see §4.1 |

### 4.1 cross_check — claim vs. reality, honestly (normative)

Let `c = claim[claimField]` and `r = evidence[evidenceField]`, where `r` is the
**trusted reference** (e.g. an independent survey). The check passes iff **all**
hold:

1. **Units match** — if `requireUnitMatch` (default true) and `claimUnit` is set,
   the evidence's unit must equal it.
2. **Within the acceptance limit** — `|c − r| ≤ max(tolerance·|r|, absolute)`. The
   relative error is normalized by the **reference**, per **VIM §2.16** — not by
   the claim. At least one of `tolerance` / `absolute` must be given; when both
   are, the limit is *whichever is greater* (an absolute floor for small
   references).
3. **Within measurement uncertainty** — when the evidence carries an expanded
   uncertainty `U = k·u` (the `uncertaintyField`, default `U`, per **JCGM 100 /
   GUM**), `|c − r| ≤ U`. This is the ISO/IEC 17025:2017 §7.8.6 simple-acceptance
   decision rule.

The `detail` string states the denominator and the limit so a reviewer can
recompute the number. A gate **passes** when every blocking check has outcome
`pass`. See [`STANDARDS.md`](STANDARDS.md) for the metrology mapping.

---

## 5. Decision outcomes

| Outcome | Meaning | Positive? |
|---------|---------|:---------:|
| `accepted` | The claim is accepted as a fact. | ✓ |
| `accepted_with_exceptions` | Accepted with noted remarks / a punch list. | ✓ |
| `rejected` | The claim is not accepted. | |
| `returned_for_rework` | Sent back to be corrected and resubmitted. | |

A `decision.recorded` may carry `acceptedValues` — the quantities the reviewer
actually accepted (e.g. surveyed 117, not claimed 120). Money is paid on these.

---

## 6. Consequences

What an outcome releases. Each lists the outcomes it fires `on`, and each fired
effect carries a stable `effectId = sha256(decisionEventId : ruleId)` so external
delivery is exactly-once on replay (see [`packages/engine/src/effects.ts`](packages/engine/src/effects.ts)).

| Effect | Result |
|--------|--------|
| `money` | a payable amount (§6.1) |
| `right_to_proceed` | the next step / work package unlocks |
| `risk` | liability is assigned to a role/party |
| `dataset_label` | a labelled record is appended (§7) |

### 6.1 money (normative)

For a unit-rate line the payable is computed on the **accepted** quantity, in
integer minor units (cents) to avoid float drift, resolved in order:
`decision.acceptedValues[field]` → the surveyed reference → the claim (last
resort).

```text
gross         = round(accepted_qty × unitPrice)
retention     = min(round(gross × retentionPct), retentionCap)
net_certified = gross − retention
vat           = round(net_certified × vatRate)        (a memo, not part of EV)
payment_due   = decided_at + paymentTermsDays
```

The fired `money` effect surfaces `gross`, `retention`, `net`, `vat`, `currency`,
`quantity`, `quantitySource`, and the `estimateLine` / `contractRef`.

---

## 7. Dataset labels

Schema: [`spec/schema/dataset-label.schema.json`](spec/schema/dataset-label.schema.json).
Every decided case yields one labelled record carrying **both** the claimed and
the accepted values, the evidence kinds, and per-check outcomes → the decided
`label`. Accumulated, these `features → label` rows are the substrate for §8.

---

## 7.5 Zones as anchors (optional, spatial)

A claim field may have kind `zone`: a place in a 3D model of the operation — one
block of a building (*section × row × floor*, id like `A1-F03`), its format checked
by a `field_pattern` check (§4). Beyond the format check the engine treats it as an
ordinary string that the consequences and dataset label carry through.

A zone is an **anchor**. Many works (cases) and documents (evidence) reference the
same zone over time, and the engine **inverts** that link. Given folded states,
`indexByZone(states)` returns, per zone:

- `works` — each contributing case (title, status, accepted money);
- `documents` — the evidence refs across those cases;
- `rollup` — `{ total, accepted, pct }`.

This is the bridge to the spatial view in [`viz/`](viz/README.md): the 3D zone
selector reads `viz/model/attachments.json` (this exact shape), so the block you
click and the facts the engine accepted are one truth. A zone is typically built by
several **parallel systems** (structure → envelope → MEP → fit-out), each its own
case unlocking the next via a `right_to_proceed` consequence, and is **cross-domain**
(a facilities acceptance can anchor to the same block as the construction work).
Worked example: [`examples/construction/systems/`](examples/construction/systems).

**Validation across cases.** Some rules a single in-case check can't see, because
they span cases and the model. `lintZones(states, model)` flags `unknown_zone` (a
claim anchored to a zone the model lacks) and `duplicate_acceptance` (the same
zone + system accepted twice). Implemented in
[`packages/engine/src/zones.ts`](packages/engine/src/zones.ts).

Zones are **non-normative**: an engine may ignore them and still conform (§11).
They add a spatial control surface over the same accepted facts.

---

## 8. Automation policy

A gate may declare when a decision can be made **without a human**:

```jsonc
"policy": { "autoAcceptWhen": { "checksPass": true, "maxAmount": 2000 } }
```

`autodecide(gate, state, now)` returns the decision a policy *would* record —
`accepted` by `system:auto` — only when all blocking checks pass and the **net
certified** value is `≤ maxAmount`. `now` is a required argument (the triggering
event's time), never the wall clock, so the auto-decision replays identically.

`maxAmount` is the value below which automating is cheaper than reviewing,
derived from the review-vs-leakage break-even — not a magic number. See
[`docs/ECONOMICS.md`](docs/ECONOMICS.md), and [`eval/replay.mjs`](eval/replay.mjs)
which scores a policy's coverage / agreement / false-accept rate against labels.

---

## 9. Standards

The Acceptance Act maps onto standards organizations already use, so the record is
portable and a gate drops into existing systems. The real, field-level mappings —
W3C PROV-O, OMG DMN 1.4, JCGM 100/200 (GUM/VIM), ISO/IEC 17025:2017, ANSI/EIA-748
(EVM), with an honest load-bearing-vs-decorative split — are in
[`STANDARDS.md`](STANDARDS.md).

---

## 10. Authority is proven, not asserted

The `reviewerRole` on a `decision.recorded` event is advisory on the wire. Over
the HTTP/MCP surface the engine binds authority to the caller's OAuth 2.1 scope:
a token with `og:decide:<role>` (or `og:decide:*`) may decide a gate whose
`reviewer.role` is `<role>`; the actor is the token subject. There is no anonymous
decision path. See [`packages/engine/src/auth.ts`](packages/engine/src/auth.ts) and
[`docs/MCP.md`](docs/MCP.md).

---

## 11. Conformance

A conforming implementation:

1. accepts gate definitions and event logs matching [`spec/schema/`](spec/schema/);
2. folds a log into a state deterministically, idempotently, and without reading
   the wall clock (§3);
3. enforces the rules in §3 (reviewer role; blocking checks gate positive
   outcomes) and the `cross_check` semantics in §4.1;
4. computes consequences per §6 (accepted quantity, retention, minor units) and a
   dataset label per §7.

Conformance is **executable and language-agnostic**: [`conformance/`](conformance/)
holds the normative state each case must fold to, and
[`conformance/README.md`](conformance/README.md) defines exactly which fields are
normative. Reproduce those states in any language and you are conformant.

[`packages/engine/`](packages/engine/) is **one** reference implementation
(non-normative) — it passes the conformance suite, but it is not privileged.
