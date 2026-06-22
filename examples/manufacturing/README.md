# Manufacturing — batch QC acceptance

> 📝 Prose stub. Ready to be turned into a `gate.json`. See
> [`../_template/`](../_template/) and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

**The expensive disputed fact:** production claims a batch is good and ready to
ship; QC finds — or might find — a defect. Until QC accepts, the batch can't
move to finished-goods inventory and can't be sold.

## The seven questions

**Claim** — `batch_conforming`: batch id, quantity, product spec/grade,
production line, shift.

**Evidence** — inspection report (sampled measurements), test certificates,
defect log, machine telemetry for the run.

**Checks**
- required evidence: inspection report present;
- field range: measured key characteristic within spec limits (min/max);
- cross-check: claimed conforming quantity within tolerance of inspected
  conforming count.

**Reviewer** — `qc_inspector` accepts responsibility for releasing the batch.

**Decision** — accepted / accepted_with_exceptions (concession/deviation
approved) / rejected (quarantine/scrap) / returned_for_rework (rework order).

**Consequence**
- money: accepted units become finished-goods value, available to sell;
- right to proceed: batch released from quarantine to inventory;
- risk: QC carries liability for the release decision.

**Dataset** — `manufacturing.batch_acceptance`: claim + measurements + check
outcomes → decision. The substrate for predicting which runs are reliably
conforming and can be auto-released.
