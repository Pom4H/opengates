# Construction — work-volume acceptance

> The flagship worked gate: definition + accept / dispute / remarks scenarios +
> a hidden-works gate + a labelled dataset + tests.

**The expensive disputed fact:** a contractor reports a completed volume for a
billing period; technical supervision (технадзор) has not accepted it. Until they
do, the contractor isn't paid for it and the next package can't close out. The
gate reconciles three numbers that are usually argued over email — the **КС-2
claim**, the **обмер (survey) measurement**, and the **смета (estimate) rate** —
into one signed, event-sourced act, so the **КС-3 payment certificate is computed
on what was *accepted*, not on what was *claimed*.**

## The gate

| | |
|---|---|
| **Claim** | `work_volume_completed`: `work_item`, `quantity` (m³), `period`. |
| **Evidence** | `executive_survey` (обмер — drives payment), `concrete_strength_protocol`, `works_log`, `aosr_ref` — all required; `delivery_notes` optional (supply side, not proof of execution). |
| **Checks** | executive documentation complete; **claim vs. survey** within 5% of the surveyed value **or** 2 m³ (whichever greater) **and** within the survey's uncertainty U; quantity non-negative. |
| **Reviewer** | `technical_supervisor`. |
| **Decision** | `accepted` / `accepted_with_exceptions` / `rejected` / `returned_for_rework`. |
| **Consequence** | money: **accepted** m³ × €85, less 5% guarantee retention · unlock `WP-foundation-closeout` · liability to the supervisor · dataset label. |

Definition: [`gate.json`](gate.json).

## Scenarios

### Accept — claimed 120, surveyed 117 ([`scenario.accept.json`](scenario.accept.json))

The survey reads **117 m³ with expanded uncertainty U = 4 m³ (k = 2, ~95%)** from a
calibrated total station. The error `|120 − 117| = 3 m³ = 2.56% of the reference`
is within both the 5% tolerance and U, so supervision **accepts 117 m³ — not the
claimed 120.**

```bash
npm run demo:accept        # from the repo root
```

| | € |
|---|--:|
| Gross earned value — 117 m³ × €85 | 9 945.00 |
| Retention (5%) | −497.25 |
| **Certified net** | **9 447.75** |
| VAT (memo, 20% of net) | 1 889.55 |

…plus `WP-foundation-closeout` unlocked, liability on the supervisor, and an
`accepted` dataset row carrying `claimed: 120` and `accepted: 117`.

### Dispute — claimed 120, surveyed 100 ([`scenario.dispute.json`](scenario.dispute.json))

`|120 − 100| = 20 m³ = 20% of the reference` — an order of magnitude beyond U and
far outside tolerance. The cross-check fails, so acceptance is impossible; it is
returned for rework.

```bash
npm run demo:dispute
```

Result: `checksPassed: false`, `status: returned_for_rework`, **€0 certified**,
the stage stays locked. Paying the claim would have certified `120 × 85 = €10,200`
against `100 × 85 = €8,500` supportable — **€1,700 of overclaim leakage caught on
one line.**

### Remarks — accepted with a punch list ([`scenario.remarks.json`](scenario.remarks.json))

The modal real-site outcome: survey 118, accepted **with замечания** (cold joint,
surface defects) to remediate by a deadline. Pays the accepted 118 m³ (gross
€10,030, net €9,528.50) and holds the retention against the open punch list.

```bash
npm run demo:remarks
```

## Also here

- [`hidden-works/`](hidden-works/) — the **АОСР** gate: the act must be signed
  *before* the work is covered; the right to pour is the consequence.
- [`dataset.sample.jsonl`](dataset.sample.jsonl) — 10 labelled cases the eval
  harness replays (`npm run eval` from the repo root) to score the automation
  policy: coverage 0.5, agreement 1.0, false-accept 0.

## Notes

- The €85/m³ rate, 5% retention, 20% VAT and the `ФЕР06-01-001-01` estimate line
  are illustrative; a real gate sources them from the contract.
- The `policy` auto-accepts only below €2,000 net once checks pass — derived from
  the review-vs-leakage break-even (see [`../../docs/ECONOMICS.md`](../../docs/ECONOMICS.md)).
  The €9,447.75 case above exceeds that ceiling, so a human decides.
