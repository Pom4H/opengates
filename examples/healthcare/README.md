# Healthcare — service confirmation

> 📝 Prose stub. Ready to be turned into a `gate.json`. See
> [`../_template/`](../_template/) and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).
>
> Note: this models the *administrative acceptance* of a rendered service for
> reimbursement — not clinical decision-making.

**The expensive disputed fact:** a provider claims a service was rendered; the
payer (insurer) won't confirm it for reimbursement without documentation and
coding that match policy. Until confirmed, the claim line is unpaid and may be
denied.

## The seven questions

**Claim** — `service_rendered`: patient/encounter id, service/procedure code,
quantity/units, date of service, rendering provider.

**Evidence** — signed clinical note, authorization reference, eligibility
record, supporting documentation for the code.

**Checks**
- required evidence: clinical note + eligibility present;
- field present: procedure code maps to a covered benefit;
- cross-check: claimed units within tolerance of documented units.

**Reviewer** — `claims_adjudicator` (payer side) accepts responsibility for the
confirmation.

**Decision** — accepted (confirmed) / accepted_with_exceptions (down-coded) /
rejected (denied) / returned_for_rework (request for information).

**Consequence**
- money: confirmed service becomes a payable claim line at the contracted rate;
- right to proceed: the claim advances to remittance;
- risk: adjudicator owns the confirmation decision and audit exposure.

**Dataset** — `healthcare.service_confirmation`: claim + documentation + coding
checks → decision. The basis for auto-adjudicating clean, well-documented
claims.
