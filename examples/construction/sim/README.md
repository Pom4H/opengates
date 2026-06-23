# Close-to-reality simulation

Where [`e2e/`](../e2e) runs an **idealized** fixed schedule, this runs a
**stochastic, resource-constrained** one and folds the result through the
**unchanged** engine. The world is variable and contended; the acceptance,
money and ledger are real. Design:
[`docs/architecture/realistic-simulation.md`](../../../docs/architecture/realistic-simulation.md).

```bash
npm run demo:sim                                  # one world + a 200-seed ensemble
node examples/construction/sim/build-sim.ts --seed=7
```

What it models (all variability from a **seeded** `Rng`, all time on a **simulated
clock** — same seed ⇒ identical run):

- **supply** — rebar arrives after a lognormal lead time; a late delivery blocks the pour;
- **contention** — every pour competes for **one** tower crane and a 2-gang crew, so the schedule *emerges*;
- **quality** — a seeded ~18% of pours fail QC → a real `returned_for_rework` → re-pour → accept loop;
- **fold** — each finished pour → an Acceptance Act through [`../systems/gate.json`](../systems/gate.json); deliveries/consumption → the resource ledger via [`../../operations/flow.gate.json`](../../operations/flow.gate.json).

The point it makes: across 200 worlds the **finish date spreads** (P10/P50/P90 ≈
42/58/80 days) from supply + contention + rework, while the **earned value stays
constant** — money is paid on the surveyed reality, not the slip. Primitives live
in [`packages/sim/`](../../../packages/sim) (`Rng`, `Sim`, `Resource`);
`simulateOnce(seed)` / `ensemble(seeds)` are exported and covered by
`packages/sim/test/build-sim.test.ts`.
