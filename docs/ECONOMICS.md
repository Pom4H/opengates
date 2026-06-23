# Economics

The gate exists to make one payment correct. This document is the money model behind that: what a claim is worth, what the gate certifies, and what each of those numbers costs when the gate is *not* there.

Everything below is recomputable. The denominators and formulas are stated; the construction figures come from [`examples/construction/`](../examples/construction/) and are verified by the engine tests.

---

## 1. The cost of not having the gate

Four costs accrue on every acceptance line. Without a gate they are invisible — paid silently, or absorbed as rework, or carried as frozen working capital.

| Cost | Formula | What it measures |
|---|---|---|
| `expected_leakage` | `overclaim_rate × avg_claim_value × avg_overclaim_pct` | Money paid against quantity that was never supportable. |
| `expected_rework` | `dispute_rate × (remeasure_cost + re_review_cost)` | Cost of re-opening a line that should have been right the first time. |
| `frozen_capital` | `net_certified × annual_cost_of_capital × cycle_days / 365` | Working capital trapped while a line sits undecided. |
| `control_cost` | `review_minutes / 60 × loaded_reviewer_rate` | What the review itself costs. |

The gate's job is to drive `expected_leakage` and `expected_rework` toward zero, shrink `cycle_days` (and with it `frozen_capital`), and keep `control_cost` below what it prevents.

### Construction worked numbers

Assumptions, sized to the flagship line (`gross ≈ €9,945`, i.e. 117 m³ × €85 — a representative high-value line, **not** the dataset mean): `overclaim_rate = 15%`, `avg_overclaim_pct = 8%`, cost of capital `10%/yr`, observed `cycleDays = 2.25`. The rates are illustrative; the point is the shape.

| Cost | Substitution | Per line of this size |
|---|---|---|
| `expected_leakage` | `0.15 × 9,945 × 0.08` | **≈ €119** |
| `frozen_capital` | `9,447.75 × 0.10 × 2.25 / 365` | **≈ €5.8** |
| `expected_rework` | `dispute_rate × (remeasure_cost + re_review_cost)` | site-specific |
| `control_cost` | `review_minutes / 60 × loaded_reviewer_rate` | site-specific |

`expected_leakage` is the headline: ~€119 of overpayment risk on a line this size, *before* any single dispute lands. The one dispute below lands much larger.

---

## 2. The accepted-quantity payment math

Money is paid on the **accepted** quantity, never the claimed one. The accepted quantity resolves in order: `decision.acceptedValues[field]` → the surveyed reference → the claim (last resort). All arithmetic is in integer minor units (cents) to avoid float drift. This is the normative computation in [`SPEC.md` §6.1](../SPEC.md#61-money-normative).

```text
gross         = round(accepted_qty × unitPrice)
retention     = min(round(gross × retentionPct), retentionCap)
net_certified = gross − retention
vat           = round(net_certified × vatRate)        (a memo, not earned value)
payment_due   = decided_at + paymentTermsDays
```

The fired `money` effect surfaces `gross`, `retention`, `net`, `vat`, `currency`, `quantity`, `quantitySource`, and the `estimateLine` / `contractRef`. By [ANSI/EIA-748 (EVM)](https://en.wikipedia.org/wiki/Earned_value_management), `accepted_qty × rate` *is* BCWP (earned value) — so certifying the wrong quantity corrupts the earned-value baseline, not just one invoice.

### The three construction outcomes

Line: claim **120 m³** at **€85/m³**, retention **5%**, VAT **20%** (memo), independent survey **117 m³** with expanded uncertainty **U = 4 m³** (k=2, ~95%; Leica TS16, calibration on file).

The decision rule ([ISO/IEC 17025:2017 §7.8.6](https://www.iso.org/standard/66912.html)): error against the reference ([JCGM 200:2012 / VIM §2.16](https://www.bipm.org/en/committees/jc/jcgm/publications)) is `|120 − 117| = 3 m³ = 2.56%` of the reference — within the 5% tolerance **and** within `U = 4`. So the accepted quantity is **117, not 120**.

| Outcome | Accepted qty | gross | retention | net certified | vat (memo) |
|---|---|---|---|---|---|
| **accept** (survey 117) | 117 | €9,945 | €497.25 | **€9,447.75** | €1,889.55 |
| **accepted_with_exceptions** (survey 118) | 118 | €10,030 | €501.50 | **€9,528.50** | €1,905.70 |
| **returned_for_rework** (survey 100) | 0 | — | — | **€0** | — |

Check the accept row by hand: `gross = 117 × 85 = 9,945`; `retention = min(9,945 × 0.05, cap) = 497.25`; `net = 9,945 − 497.25 = 9,447.75`; `vat = 9,447.75 × 0.20 = 1,889.55`. The remarks row holds retention against the open punch list. The dispute row certifies **€0** — see below.

---

## 3. The €1,700 caught on one line

A disputed claim: survey reads **100 m³** against a claim of **120**.

```text
error  = |120 − 100| = 20 m³ = 20% of the reference
limit  = 5% tolerance, U = 4 m³
20% ≫ 5% and 20 ≫ 4  →  returned_for_rework, €0 certified
```

The blocking check fails, so the gate forbids a positive outcome. Compare what each path would certify:

| | Quantity | gross |
|---|---|---|
| Pay the claim | 120 | 120 × 85 = €10,200 |
| Supportable | 100 | 100 × 85 = €8,500 |
| **Overclaim leakage** | 20 | **€1,700** |

One line, one check, **€1,700** of overpayment caught — versus the ~€119 *expected* leakage a line this size carries. The gate turns a statistical loss into a specific, blocked transaction.

---

## 4. `maxAmount` is a break-even, not a magic number

A gate may auto-decide low-value lines. The threshold is the value below which automating is cheaper than the overpayment risk of a wrong auto-accept:

```text
maxAmount_breakeven = manual_review_cost / (auto_error_rate × avg_overpayment_fraction)
```

Worked: `€12 / (0.01 × 0.10) = €12,000` **gross**. That is the point where the saved review cost equals the expected overpayment from automating. The policy then takes a **risk-adjusted floor** down to **€2,000 net** — automating only well inside the break-even, so the expected saving dominates the expected error by a wide margin.

```jsonc
"policy": { "autoAcceptWhen": { "checksPass": true, "maxAmount": 2000 } }
```

`autodecide(gate, state, now)` returns `accepted` by `system:auto` only when every blocking check passes **and** `net_certified ≤ maxAmount`. `now` is a required argument (the triggering event's time), never the wall clock — so the auto-decision replays identically. See [`packages/engine/src/index.ts`](../packages/engine/src/index.ts).

---

## 5. Cycle time is free, from the event log

`cycleDays` is not estimated — it falls out of two timestamps already on the log: `submittedAt` (the `claim.submitted` event) and `decidedAt` (the `decision.recorded` event). `GateState.cycleDays` is computed by `fold`; no clock, no extra instrumentation.

```text
cycleDays      = decidedAt − submittedAt           (construction: 2.25)
frozen_capital = net_certified × cost_of_capital × cycleDays / 365
             = 9,447.75 × 0.10 × 2.25 / 365  ≈  €5.8 / line
```

Because the figure is derived from data the log already carries, cost-of-delay reporting is a property of replay, not a separate metrics pipeline. Drive `cycleDays` down and `frozen_capital` follows for free.

---

## 6. Tie-back: replay scores the automation policy

`maxAmount` is only honest if the policy it gates is measured against real labels. [`eval/replay.mjs`](../eval/replay.mjs) folds each labelled case in a dataset, asks `autodecide` what the policy *would* do, and reports three numbers:

| Metric | Definition |
|---|---|
| `coverage` | fraction of cases the policy auto-decides |
| `agreement` | of those, fraction matching the human label |
| `falseAcceptRate` | of those, fraction auto-accepted where the human did not |

```bash
node eval/replay.mjs examples/construction/gate.json examples/construction/dataset.sample.jsonl
```

Over the 10-case [`dataset.sample.jsonl`](../examples/construction/dataset.sample.jsonl) (8 accepted, 2 returned):

| Metric | Value |
|---|---|
| `coverage` | **0.5** |
| `agreement` | **1.0** |
| `falseAcceptRate` | **0** |

Half the cases clear without a human; every one the policy touched matched the human label; nothing was wrongly auto-accepted. The publishable bar (`coverage ≥ 0.40`, `agreement ≥ 0.99`, `falseAcceptRate = 0`) is met — so the `€2,000` floor is automating exactly the slice it claims to, and the leakage, rework, and capital costs above are charged against a measured policy rather than a guess.
