# Retail — goods receiving

> 📝 Prose stub. Ready to be turned into a `gate.json`. See
> [`../_template/`](../_template/) and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

**The expensive disputed fact:** a supplier claims a shipment (per the purchase
order / ASN); the warehouse counts fewer units, or finds damage. Until receiving
is accepted, the supplier invoice can't be matched and paid (three-way match).

## The seven questions

**Claim** — `shipment_delivered`: PO number, SKU lines, claimed quantity per
SKU, ship date.

**Evidence** — advance shipping notice (ASN), goods-receipt scan counts, damage
report, packing list.

**Checks**
- required evidence: receipt scan present;
- cross-check: claimed quantity per SKU within tolerance of scanned quantity;
- field present: PO number matches an open order.

**Reviewer** — `warehouse_receiver` accepts responsibility for the received
quantity.

**Decision** — accepted / accepted_with_exceptions (short/over receipt recorded)
/ rejected (refused delivery) / returned_for_rework (recount).

**Consequence**
- money: accepted quantity feeds the three-way match and makes the supplier
  invoice payable;
- right to proceed: stock becomes sellable inventory;
- risk: liability for the count passes to the warehouse.

**Dataset** — `retail.goods_receiving`: claim + scan + match outcome → decision.
Trains auto-acceptance for trusted suppliers with consistently accurate ASNs.
