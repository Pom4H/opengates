# Conformance

This is where Open Gates is a **standard** rather than a library: the contract is
**data, not code**. A gate definition plus an event log MUST fold to the normative
state in [`expected/<case>.json`](expected/) — on **any** engine, in **any**
language. Reproduce these states and you are conformant; the
[reference engine](../packages/engine/) is one passing implementation, not the
authority.

```bash
node conformance/run.mjs            # check the reference engine vs the goldens
node conformance/run.mjs --update   # regenerate goldens (maintainers, after a spec change)
```

## How to verify your own engine

[`manifest.json`](manifest.json) lists the cases. Each names a gate and a scenario
(reused from [`examples/`](../examples/)). For every case:

1. Load the gate definition and the scenario's event log.
2. Fold the log into a state (per [`SPEC.md`](../SPEC.md) §2–6).
3. Reduce the state to the **normative projection** below.
4. Compare against `expected/<case>.json`. Equal ⇒ conformant for that case.

[`run.mjs`](run.mjs) does exactly this with the reference engine; port its
~40-line `project()` to your language.

## What is normative (must match)

| Field | Why it's normative |
|-------|--------------------|
| `status` | the lifecycle outcome of the fold |
| `checksPassed`, `checks[].{id,rule,outcome,severity}` | the verification result, incl. the §4.1 `cross_check` (reference-normalized error + uncertainty) |
| `decision.{outcome,role,acceptedValues}` | what was decided and the accepted quantities |
| `responsibility.role` | who the accepted fact is bound to |
| `consequences[]` — `money.{basis,currency,quantity,quantitySource,gross,retention,net,vat}`, `right_to_proceed.unlocks`, `risk.assignedTo`, `dataset_label.dataset` | the effects, incl. accepted-quantity money (§6.1) |
| `cycleDays` | derived from event timestamps (deterministic) |
| `datasetLabel.{dataset,label,claim_type,decided_by_role,features}` | the features→label record (§7) |

## What is informative (must NOT be relied on)

These are implementation-specific and are excluded from the projection:

- the human-readable `log[]` prose (wording is the engine's choice);
- event `seenIds` and other internal bookkeeping;
- `effectId` hashes — derived from event ids, which for hand-authored scenarios
  are synthesized by the loader (`<gateRef>#<seq>`), a convention, not a rule;
- timestamps echoed into prose. (The `at` *values* on events are inputs.)

## Conformance levels

A useful implementation order, each a superset of the last:

1. **Fold** — status + lifecycle from the event log (§2–3), incl. determinism
   (same log ⇒ same state; redelivered ids are no-ops).
2. **Checks** — all rules, especially `cross_check` normalized by the reference
   with the absolute floor and the uncertainty band (§4.1).
3. **Effects** — accepted-quantity money with retention/VAT in minor units (§6.1),
   plus the dataset label (§7).

The five cases here exercise all three across two domains (construction,
logistics). Add a case by appending to `manifest.json` and running `--update`.
