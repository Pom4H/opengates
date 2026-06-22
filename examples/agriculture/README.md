# Agriculture — field-treatment acceptance

> 📝 Prose stub. Ready to be turned into a `gate.json`. See
> [`../_template/`](../_template/) and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

**The expensive disputed fact:** an operator claims a field was treated (sprayed,
fertilized, sown) over a given area; the agronomist isn't sure it was done, or
done correctly, on the right parcel. Until accepted, the work-order can't be
paid and the agronomic record (and compliance trail) is unreliable.

## The seven questions

**Claim** — `field_treatment_done`: parcel id, operation type, treated area (ha),
product + dose, date.

**Evidence** — machine telemetry (GPS track + implement on/off), tank-mix log,
satellite/NDVI snapshot, operator photo.

**Checks**
- required evidence: GPS track present;
- cross-check: claimed treated area within tolerance of the area covered by the
  GPS track;
- field range: applied dose within the agronomic min/max for the product.

**Reviewer** — `agronomist` accepts responsibility for the treatment record.

**Decision** — accepted / accepted_with_exceptions (partial coverage noted) /
rejected / returned_for_rework (re-treat / re-measure).

**Consequence**
- money: accepted hectares become a payable work-order line;
- right to proceed: the field advances in the crop plan; the next operation is
  scheduled;
- risk: agronomist owns the compliance/quality record.

**Dataset** — `agriculture.treatment_acceptance`: claim + telemetry + checks →
decision. Lets clean, well-tracked operations be auto-accepted.
