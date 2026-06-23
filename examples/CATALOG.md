# Catalog — gates worth modelling

Each row is the same shape as the worked examples: a place where a *claim* meets a
*reference* and a role decides. They are listed here, not given their own folder,
until someone contributes a `gate.json` + a scenario — at which point they graduate
to a worked example. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) and
[`_template/`](_template/) to add one.

| Domain | Gate | The expensive disputed fact | The reference that settles it |
|--------|------|------------------------------|-------------------------------|
| manufacturing | batch QC acceptance | a batch is claimed in-spec; QC finds a defect | incoming-inspection / lab measurement vs. spec limits + tolerance |
| retail | goods receiving | a supplier claims a shipment; the warehouse received less | scan / weighbridge count vs. the delivery note |
| agriculture | field-treatment acceptance | a field was treated; the agronomist isn't sure | as-applied telemetry / sample vs. the work order |
| healthcare | service confirmation | a service was rendered; the payer won't confirm it | clinical record / coding audit vs. the claim |
| insurance | claim adjudication | a loss is claimed; the adjuster must confirm it | survey / estimate vs. the policy schedule |

The pattern is identical to the [construction](construction/) and
[logistics](logistics/) gates: a claimed value, a trusted reference, a tolerance
(and, where there is measurement, an uncertainty), a role that owns the decision,
and a consequence — money, a right to proceed, assigned risk — that fires once.
