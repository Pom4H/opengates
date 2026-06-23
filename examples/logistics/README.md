# Logistics — delivery acceptance

> A second worked gate, to show the primitive generalizes past construction.

**The expensive disputed fact:** a carrier reports a completed delivery; the
customer disputes that it arrived on time (or in full). Until the receiver
accepts, the leg isn't invoiceable and the next one can't be planned against it.

## The gate

| | |
|---|---|
| **Claim** | `delivery_completed`: `shipment_id`, `quantity` (pallets), `delivered_at`. |
| **Evidence** | `proof_of_delivery` (required), `weighbridge_ticket` (optional). |
| **Checks** | POD present (blocking); delivered inside the agreed **time window** (blocking `date_window`); pallet count within 2% of the weighbridge scan (warning, advisory). |
| **Reviewer** | `customer_receiver`. |
| **Consequence** | money: accepted pallets × €40 invoiceable · unlock `transport-leg-closeout` · liability to the receiver · dataset label. |
| **SLA** | 24h, `high` priority, escalates to `goods-in-escalation`. |

Definition: [`gate.json`](gate.json).

## Scenarios

Fold either against the gate:

```bash
node packages/engine/src/cli.ts examples/logistics/gate.json examples/logistics/scenario.accept.json
```

- **Accept** ([`scenario.accept.json`](scenario.accept.json)) — delivered 12:05,
  inside the 08:00–18:00 window; weighbridge confirms 26 pallets → accepted,
  `26 × 40 = €1,040` invoiceable.
- **Dispute** ([`scenario.dispute.json`](scenario.dispute.json)) — delivered a day
  late, outside the window → the blocking `date_window` check fails → returned for
  rework, nothing invoiceable.

The only thing that changed from construction is the gate definition: a
`date_window` check instead of a survey cross-check, a different rate, a tighter
SLA. The engine, the fold, the queue and the MCP tools are identical.
