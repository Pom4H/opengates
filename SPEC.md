# Open Gates Specification (v0.1, draft)

> Level 1 of the [ladder](README.md#whats-in-this-repository). This document is
> the normative description of the Business Gate Pattern. The machine-readable
> form lives in [`spec/schema/`](spec/schema/); the reference implementation in
> [`engine/`](engine/).

A **gate** is a named decision point where a *claim* becomes an *accepted fact*
— or is rejected — with real consequences. The spec separates two things:

- a **gate definition** — the reusable pattern (claim shape, evidence, checks,
  reviewer, decisions, consequences). One per kind of acceptance.
- a **gate case** — one actual run, expressed as an ordered log of **events**
  that *fold* into a **state**.

```text
claim → evidence → checks → decision → consequences → dataset label
```

---

## 1. Gate definition

Schema: [`spec/schema/gate.schema.json`](spec/schema/gate.schema.json).

| Field | Meaning |
|-------|---------|
| `id` | Stable identifier, e.g. `construction.work-volume-acceptance`. |
| `name`, `domain`, `description` | Human framing. |
| `claim` | The shape of the asserted fact: a `type` and a list of typed `fields`. |
| `evidence` | The kinds of evidence that may/must back the claim (`required` flag). |
| `checks` | Deterministic verification rules (see §4). |
| `reviewer` | The `role` that accepts responsibility for the decision. |
| `decisions` | Which outcomes this gate allows (subset of §5). |
| `consequences` | What each outcome releases (see §6). |
| `policy` | Optional automation policy (see §8). |

### 1.1 Claim schema

A claim asserts a fact. Its `fields` declare `name`, `kind`
(`number` \| `string` \| `boolean` \| `date`), an optional `unit`, and whether
it is `required`.

### 1.2 Evidence requirement

Each declares a `kind` (e.g. `survey_measurement`), whether it is `required`,
and a `description`. Evidence is what turns an assertion into something
checkable.

---

## 2. Events

Schema: [`spec/schema/event.schema.json`](spec/schema/event.schema.json).

A gate case is an **append-only log**. Every event carries `at` (timestamp) and
`actor` (who emitted it).

| Event | Payload | Meaning |
|-------|---------|---------|
| `claim.submitted` | `claim` (type + values) | The fact is asserted. |
| `evidence.attached` | `evidence` (kind, values, ref) | Evidence is provided. |
| `decision.recorded` | `reviewerRole`, `outcome`, `note` | A role accepts responsibility. |

Events are facts about what happened; they are never edited. To change an
outcome you append another event.

---

## 3. State and lifecycle

The engine *folds* the event log into a single **state** (status, checks,
decision, responsibility, consequences, dataset label, and a human-readable
log).

```text
        ┌────────┐  claim.submitted   ┌───────────┐  evidence + claim present
        │ draft  ├──────────────────► │ submitted ├──────────────────────────┐
        └────────┘                    └───────────┘                           ▼
                                                                       ┌──────────────┐
                                                                       │ under_review │
                                                                       └──────┬───────┘
                                              decision.recorded by reviewer   │
              ┌──────────────────────────────────────────────────────────────┤
              ▼                 ▼                     ▼                        ▼
        ┌──────────┐   ┌────────────────────────┐  ┌──────────┐   ┌────────────────────┐
        │ accepted │   │ accepted_with_exception│  │ rejected │   │ returned_for_rework│
        └──────────┘   └────────────────────────┘  └──────────┘   └────────────────────┘
```

Rules enforced by the engine:

- A **positive** outcome (`accepted`, `accepted_with_exceptions`) is only valid
  when every **blocking** check has passed; otherwise the decision is refused
  and the case stays `under_review`.
- Only the gate's `reviewer.role` may decide; a decision from any other role is
  ignored (and logged).
- A positive outcome sets `responsibility` — the reviewer now owns the accepted
  fact.

---

## 4. Checks

A check is a deterministic rule evaluated against the current claim + evidence.
Each has an `id`, optional `description`, and a `severity` of `blocking`
(default) or `warning`. Warnings never block acceptance.

| Rule | Parameters | Passes when |
|------|------------|-------------|
| `required_evidence` | `kinds[]` | every listed evidence kind is present |
| `field_present` | `field` | the claim field is set and non-empty |
| `field_range` | `field`, `min?`, `max?` | the numeric field is within range |
| `cross_check` | `claimField`, `evidenceKind`, `evidenceField`, `tolerance` | `|claim − evidence| / |claim| ≤ tolerance` |

`cross_check` is the heart of the pattern: it compares **claim vs. reality**.
When the referenced evidence isn't attached yet, a check evaluates to `skipped`,
and the corresponding `required_evidence` check is what blocks acceptance.

A gate **passes** when every blocking check has outcome `pass`.

---

## 5. Decision outcomes

| Outcome | Meaning | Positive? |
|---------|---------|:---------:|
| `accepted` | The claim is accepted as a fact. | ✓ |
| `accepted_with_exceptions` | Accepted despite warnings / noted caveats. | ✓ |
| `rejected` | The claim is not accepted. | |
| `returned_for_rework` | Sent back to be corrected and resubmitted. | |

---

## 6. Consequences

What an outcome releases. Each consequence lists the outcomes it fires `on`.

| Effect | Parameters | Result |
|--------|------------|--------|
| `money` | `currency` + (`quantityField` × `unitPrice`) or fixed `amount` | an amount becomes payable |
| `right_to_proceed` | `unlocks` | the next step / work package is unlocked |
| `risk` | `assignedTo` | liability is assigned to a role/party |
| `dataset_label` | `dataset` | a labelled record is appended (see §7) |

Consequences are the reason a gate matters: this is where **money, risk, and the
right to proceed** become explicit and attributable.

---

## 7. Dataset labels

Every decided case yields one labelled record:

```jsonc
{
  "dataset": "construction.work_acceptance",
  "gate": "construction.work-volume-acceptance",
  "claim_type": "work_volume_completed",
  "features": { /* claim values + evidence kinds + per-check outcomes */ },
  "label": "accepted",
  "decided_by_role": "technical_supervisor",
  "at": "2026-06-03T15:00:00Z"
}
```

The `features → label` pairs are the substrate for §8: as they accumulate, some
decisions become predictable, then automatable.

---

## 8. Automation policy

A gate may declare when a decision can be made **without a human**:

```jsonc
"policy": { "autoAcceptWhen": { "checksPass": true, "maxAmount": 2000 } }
```

The engine's `autodecide(gate, state)` returns the decision a policy *would*
record — `accepted` by `system:auto` — only when all blocking checks pass and
the economic value is within `maxAmount`. High-value or unchecked claims stay
with a human. This encodes the final step of the primitive: **part of the
decisions becomes automatable**, deliberately and under an explicit ceiling.

---

## 9. Standards mappings (Level 4, planned)

The pattern is intentionally compatible with existing standards. Future work
will provide explicit mappings:

- **W3C PROV** — claim/evidence/decision as provenance (entity, activity, agent).
- **BPMN / DMN** — the gate as a decision task with a decision table.
- **EVM** — accepted quantity × rate as earned value.
- **ISO 19650 / IFC** — construction information delivery and model references.

These are mappings, not dependencies: a gate is meaningful on its own.

---

## 10. Conformance

A conforming implementation:

1. accepts gate definitions and event logs matching the schemas in
   [`spec/schema/`](spec/schema/);
2. folds an event log into a state deterministically;
3. enforces the rules in §3 (reviewer role, blocking checks gate positive
   outcomes);
4. computes consequences per §6 and a dataset label per §7.

The [`engine/`](engine/) directory is the reference implementation.
