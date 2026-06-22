# Insurance — claim adjudication

> 📝 Prose stub. Ready to be turned into a `gate.json`. See
> [`../_template/`](../_template/) and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

**The expensive disputed fact:** a policyholder claims a covered loss of some
amount; the adjuster must confirm the loss is real, covered, and correctly
valued before it's paid. Until adjudicated, the payout is frozen and the
reserve is uncertain.

## The seven questions

**Claim** — `loss_claimed`: policy id, peril/cause, date of loss, claimed
amount, affected items.

**Evidence** — incident report, photos, repair estimate / invoice, police or
third-party report, policy coverage record.

**Checks**
- required evidence: incident report + estimate present;
- field present: policy active on the date of loss; peril is covered;
- cross-check: claimed amount within tolerance of the independent estimate.

**Reviewer** — `claims_adjuster` accepts responsibility for the adjudication.

**Decision** — accepted (approved) / accepted_with_exceptions (partial /
adjusted amount) / rejected (denied) / returned_for_rework (further
investigation).

**Consequence**
- money: approved amount (net of deductible) becomes payable; the reserve is
  updated;
- right to proceed: the claim advances to settlement/payment;
- risk: the adjuster owns the adjudication and leakage exposure.

**Dataset** — `insurance.claim_adjudication`: claim + evidence + coverage/valuation
checks → decision. Lets low-amount, well-evidenced, clearly covered claims be
straight-through processed.
