# Logistics — delivery acceptance

> 📝 Prose stub. Ready to be turned into a `gate.json`. See
> [`../_template/`](../_template/) and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

**The expensive disputed fact:** the driver claims a delivery was made (on time,
in full); the customer disputes quantity, condition, or timing. Until it's
accepted, the invoice can't be confirmed and demurrage/penalties are unclear.

## The seven questions

**Claim** — `delivery_completed`: shipment id, delivered quantity, delivered-at
timestamp, destination.

**Evidence** — proof of delivery (POD) signature, geofence/GPS arrival event,
photo of unloaded goods, weighbridge ticket.

**Checks**
- required evidence: POD present;
- cross-check: claimed quantity within tolerance of weighbridge/scan count;
- field range: delivered-at within the agreed delivery window.

**Reviewer** — `customer_receiver` (the consignee's goods-in role) accepts
responsibility for the delivery.

**Decision** — accepted / accepted_with_exceptions (short/over delivery noted) /
rejected / returned_for_rework.

**Consequence**
- money: the delivery becomes invoiceable; penalties/demurrage computed from the
  window check;
- right to proceed: POD unlocks payment and closes the transport leg;
- risk: liability for accepted goods passes to the consignee.

**Dataset** — `logistics.delivery_acceptance`: claim + POD + window/quantity
checks → decision. Trains future auto-acceptance of clean, on-time, in-full
deliveries.
