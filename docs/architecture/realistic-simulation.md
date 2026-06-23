# Close-to-reality simulation — foundational architecture

> Status: **v0 — foundation built.** The deterministic-randomness primitive, the
> resource-constrained DES kernel and a worked stochastic build all ship today:
> [`packages/sim/`](../../packages/sim) (`Rng`, `Sim`, `Resource`),
> [`examples/construction/sim/build-sim.ts`](../../examples/construction/sim/build-sim.ts).
> Run `npm run demo:sim`. This complements the **idealized** e2e
> ([`examples/construction/e2e/`](../../examples/construction/e2e)) and reuses the
> resource layer ([`resource-flow-and-domains.md`](resource-flow-and-domains.md)).
> The acceptance engine ([`packages/engine`](../../packages/engine)) is **not
> touched** — that separation is the whole point.

## 1. The problem

The e2e simulator ([`drive.ts`](../../examples/construction/e2e/drive.ts)) proves a
whole building is *representable* as Acceptance Acts — but its world is
**idealized**: the schedule is a fixed `daysPerBuildUnit × arrival` table, disputes
fire on a periodic `hash % N`, and nothing models a late delivery, a crane two bays
are both waiting on, or a wet week. To ask operational questions — *when will this
realistically finish? how exposed are we to supply slips? is one crane enough?* —
the world that **produces** the claims has to behave like a real site:
variable, contended, and occasionally going wrong.

## 2. The two invariants we refuse to break

Realism usually means non-determinism. Open Gates forbids it. We keep **both**:

1. **The engine stays pure.** `fold(gate, events) → state` reads no clock, no
   randomness ([SPEC §0](../../SPEC.md)). The simulator lives in a **separate
   package** and only ever hands the engine an ordinary event log. The engine is
   the judge; the simulator is the world. Nothing stochastic crosses that line.
2. **A run stays replayable.** Same inputs ⇒ identical output, forever — the same
   promise `drive.ts` makes. We get variability *and* replay by banning
   `Math.random()` and `Date.now()` and drawing every random number from one
   explicitly **seeded** generator, and reading time from a **simulated clock**.

> The trick in one line: **a simulation is a deterministic function of its seed.**
> Vary the seed → a different world; fix the seed → the same world, byte-for-byte.

## 3. Architecture

```
            SIMULATOR  (impure-looking, but a pure function of the seed)        ENGINE (pure, untouched)

 seed ─► Rng.stream(name) ─┐                                                     gate.json
                            ├─► reality models ─► DES kernel ─► world events ─► claim/evidence/decision ─► fold() ─► accepted facts
 reality.json (the dials) ─┘   (durations,         (clock +      (a pour done,                                          │  + money
                                lead times,         finite        a delivery late)                                      ▼
                                defects, weather)   resources)                                              same projections as e2e
                                                                                                        (attachments/timeline/ledger)
       ─────────────────────────────────  vary ONLY the seed  ──────────────────────────────────►  ENSEMBLE → P10/P50/P90
```

### L0 — Deterministic randomness (`packages/sim/src/random.ts`) ✅

A seeded SplitMix64 `Rng` with the distributions a site needs — `lognormal`
(durations, lead times: positive, right-skewed), `triangular` (bounded
estimates), `bernoulli`, `poisson` (defects/breakdowns per period), `weighted`.

The load-bearing feature is **`stream(name)`**: independent sub-generators derived
from the *root* seed, not the live state. Adding a draw in one concern (say,
`weather`) does **not** shift the numbers another concern (`supply`) draws — the
exact failure mode that makes a global `Math.random()` unrepeatable. Streams are
also order-independent: deriving `stream("durations")` gives the same sequence no
matter how many draws happened on the parent first.

### L1 — Reality models (the dials)

Each kind of friction is a named, parameterized model over an `Rng` stream, so
realism is **config, not code**. In the worked example they live in one `PROFILE`
object; the design intent is a `reality.json` profile:

| concern | model | effect on the world |
|---|---|---|
| productivity | `lognormal(planned, σ)` | pour/task durations vary around plan |
| supply | `lognormal(leadDays, σ)` | a late delivery **blocks** the dependent task |
| quality | `bernoulli(defectRate)` | a failed pour → real `returned_for_rework` loop |
| capacity | finite `Resource`s | contention for the crane/crew **is** the schedule |
| weather / calendar | (next) non-working days | seasonal slowdown, frozen pours |
| cost | `EV × overrun × jitter` | the actual cost the engine doesn't own (for CPI) |

**Set every variance to 0 and the run collapses to a clean deterministic
baseline** — the calibration anchor, and the bridge back to `drive.ts`'s ideal.

### L2 — DES kernel (`packages/sim/src/process.ts`) ✅

A minimal discrete-event simulation: a simulated clock, an event queue ordered by
`(time, insertion)` so ties break deterministically, and `Resource`s with finite
capacity and FIFO queues. Processes are generators that `yield` three commands —
`delay`, `seize`, `release`. **The schedule emerges** from resource contention; it
is never tabulated. (The kernel reads no wall clock and no `Math.random`.)

### L3 — Acceptance adapter (the bridge to the engine) ✅

When the world produces an outcome (a pour finishes at sim-day 47 with a surveyed
area; a delivery is 9 days late), the adapter turns it into an ordinary Acceptance
Act event log — `claim.submitted` (claimed slightly high) → `evidence.attached`
(the survey reference) → `decision.recorded` (accepted on the surveyed value, or
returned-then-accepted) — stamping each event's `at` from the **simulated** clock.
Then it folds through the **unchanged** gates
([`construction/systems`](../../examples/construction/systems),
[`operations/flow`](../../examples/operations)). Deliveries/consumption fold into
the resource ledger ([`resourceLedger`](../../packages/engine/src/flows.ts)).

### L4 — Projections & views (reused)

Folded states feed the **same** projections the e2e already emits
(`attachments` / `timeline` / `ledger` / `certificate`) and the resource
`flowGraph` / `resourceLedger`. So a simulated project drops straight into the
existing control surface and flow view — no new renderer.

### L5 — Ensemble (Monte-Carlo over seeds) ✅

Because a run is a pure function of its seed, an **ensemble varies only the seed**
to turn one number into a distribution: P10/P50/P90 finish, cost exposure, dispute
rate. Each member is still individually replayable for drill-down.

## 4. What the worked example shows

[`build-sim.ts`](../../examples/construction/sim/build-sim.ts) — 6 bays, **one**
tower crane (the bottleneck), a 2-gang crew, variable rebar lead times, an 18%
seeded defect rate driving real rework — folded through the unchanged engine:

```
one world (seed 1) — 6 pours, 0 disputed/reworked
  construction finished day 64 (2026-05-05); crane peak 1/1
  earned value accepted: €11,628; rebar ledger in 6 t / out 5.4 t

ensemble of 200 seeds:
  finish day P10/P50/P90: 42 / 58 / 80   ← supply + contention + rework
  earned value P50: €11,628 (≈ constant — paid on surveyed reality, not the slip)
  avg disputes/run: 1.09 of 6 pours
  replayable: seed 42 twice ⇒ identical
```

The honest result the architecture is built to surface: **schedule is uncertain
(42→80 days), but money is anchored to accepted reality** — exactly the boundary
Open Gates owns.

## 5. What is real vs. illustrative

- **Real & load-bearing.** Determinism/replay; resource contention shaping the
  schedule; the dispute→rework→accept loop folding through the engine; money on the
  surveyed quantity; the resource mass balance.
- **Illustrative (honestly flagged).** Distribution parameters are plausible, not
  calibrated to a real project; *actual cost* (AC/CPI) is modelled, not measured —
  it is the one figure the engine never owns.

## 6. Phased plan

1. **Primitives (L0/L2).** ✅ Seeded `Rng` + streams + distributions; DES kernel
   with finite resources. Tested (`packages/sim/test`).
2. **Adapter + worked build (L1/L3/L5).** ✅ Stochastic, resource-constrained build
   folded through the unchanged engine; Monte-Carlo ensemble.
3. **Reality profile (L1).** ⬜ Externalize `PROFILE` to a `reality.json` with a
   `variance:0` baseline that reproduces `drive.ts` exactly (a regression anchor).
4. **Scale to the full e2e.** ⬜ Drive all ~1 560 cases from the DES instead of the
   fixed `daysPerBuildUnit` table, emitting the existing four viewer files so the
   control surface shows a *simulated* (not scripted) project.
5. **Calendar & weather (L1).** ⬜ Non-working days and seasonal pour constraints.
6. **Disruptions (L1).** ⬜ Equipment breakdown (Poisson) and supply shortage as
   first-class events that re-contend resources.
