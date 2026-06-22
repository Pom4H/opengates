# Construction — work-volume acceptance

> The fully worked example. Gate definition + two scenarios + tests.

**The expensive disputed fact:** a contractor claims a completed volume of work
for a period; site technical supervision has not accepted it. Until they do, the
contractor can't be paid for it and the next work package can't close out.

This is the manifesto's flagship gate and the seed of the planned
**Construction PR** vertical:

```text
contractor → claim → evidence → technical supervision → approved earned value → payment-ready
```

## The seven questions

| | |
|---|---|
| **Claim** | `work_volume_completed`: a `work_item`, a `quantity` in m³, a `period`. |
| **Evidence** | `survey_measurement` (required), `delivery_notes`, `photo_log`. |
| **Checks** | survey present; quantity present & positive; **claimed volume within 5% of the surveyed volume** (`cross_check`). |
| **Reviewer** | `technical_supervisor` — site supervision accepts responsibility. |
| **Decision** | `accepted` / `accepted_with_exceptions` / `rejected` / `returned_for_rework`. |
| **Consequence** | money: accepted m³ × €85 earned value · right to proceed: unlock `WP-foundation-closeout` · risk: liability to the supervisor · dataset label. |
| **Dataset** | `construction.work_acceptance` — claim + evidence + check outcomes → decision. |

Definition: [`gate.json`](gate.json).

## Scenarios

### Accepted — within tolerance ([`scenario.accept.json`](scenario.accept.json))

Contractor claims **120 m³**; an independent survey measures **117 m³** (a 2.5%
difference, within the 5% tolerance). Supervision accepts.

```bash
cd ../../engine && npm run demo:accept
```

Result: `status: accepted`, `120 × 85 = €10,200` payable earned value,
`WP-foundation-closeout` unlocked, liability assigned to the supervisor, and an
`accepted` dataset label.

### Disputed — outside tolerance ([`scenario.dispute.json`](scenario.dispute.json))

Contractor claims **120 m³**; the survey measures **100 m³** (16.7% over, outside
tolerance). The cross-check fails, so the claim cannot be accepted; supervision
returns it for rework.

```bash
cd ../../engine && npm run demo:dispute
```

Result: `checksPassed: false`, `status: returned_for_rework`, **no money
released**, and a `returned_for_rework` dataset label. This is exactly the
manifesto's pain — *"the contractor claimed a volume; the supervisor hasn't
accepted it"* — made explicit and auditable.

## Notes

- The €85/m³ rate and tolerance are illustrative; a real gate would source them
  from the contract.
- The `policy` allows small claims (≤ €2,000) to be auto-accepted once checks
  pass — the automation path. The €10,200 claim above exceeds that ceiling, so a
  human still decides.
