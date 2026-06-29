# End-to-end construction — the whole cycle, folded through the real engine

> A real, full-lifecycle construction project — **design → excavation pit → foundation →
> frame → façade → MEP → fit-out → handover → payments** — driven through the
> **unchanged** Open Gates fold engine, and shown in the one 3D model every role
> shares. Built to test the hypothesis: *can Open Gates reproduce the physics of
> a real build end-to-end?* It can — see [`docs/e2e-feasibility.md`](../../../docs/e2e-feasibility.md).

The object: **«Open Gates» residential complex, Block 1** — a monolithic RC mid-rise on a
6×4 structural grid (6 m bays): a benched **excavation pit** at −9.0 m, a 1.2 m
**foundation raft**, **2 underground** + **14 above-ground** storeys and a roof.
That is **384 bays × 4 parallel systems** plus site/foundation/roof scopes —
**390 zones** in [`viz/model/building.json`](../../../viz/model/building.json).

## Run it

```bash
node viz/model/generate.ts            # 1. the spatial model (building.json)
node examples/construction/e2e/drive.ts   # 2. fold the WHOLE project → viz/model/e2e/*.json
python3 -m http.server 8099           # 3. then open the shared control surface:
#    http://localhost:8099/viz/viewer/control/
```

The simulator folds **~1 560 acceptance cases** (≈7 700 events, 51 of them
through a dispute→rework cycle), spanning **2026-01 → 2029-10**, and prints:

```
Contract value €4,030,332 (+ design fee €480 000, separate) · advance €604,550 (recovered)
  · earned value (net KS-3) €3,828,815.12 · retention reserve €201,516.88 (released) · Lint: ok
```

Earned value (net KS-3) is construction only — the design fee (design & survey works) and the
advance are pre-/non-construction lumps held in the ledger header, so EV never
exceeds the contract. EVM samples bi-weekly: the 51 disputed reworks slip
acceptance ~1 month, showing as **SPI dipping to ~0.98** and recovering.

It is **deterministic** — no `Date.now()`, no `Math.random()`; every date comes
from a zone's build-order arrival, every "friction" case is seeded off a hash of
the case id. Same inputs ⇒ byte-identical output, forever (verified by rerun).

## Close-to-reality variant — `simulate.ts`

`drive.ts` runs an **idealized** fixed schedule. [`simulate.ts`](simulate.ts)
drives the **same** project from a resource-constrained discrete-event simulation
([`packages/sim`](../../../packages/sim)): the per-bay sweep competes for finite
crews per system, durations vary (lognormal), and a seeded fraction of pours fail
QC → real `returned_for_rework` slips. The schedule **emerges**; every case still
folds through the **unchanged** gates and money is computed exactly as before.

```bash
node examples/construction/e2e/simulate.ts   # → viz/model/e2e-sim/*.json + ensemble.json
#    then open http://localhost:8099/viz/viewer/control/?src=sim
```

Same shape as `drive.ts`'s output, so the cockpit is agnostic — `?src=sim` swaps
the data source and shows the **P10/P50/P90 finish over an ensemble of seeds**
against the variance-free plan (seed 1: ≈ 443/476/499 days vs. plan 325). The
earned value is unchanged (€3.83 M) — schedule is uncertain, money is anchored to
accepted reality. Replayable (same seed ⇒ byte-identical); design:
[`docs/architecture/realistic-simulation.md`](../../../docs/architecture/realistic-simulation.md).

## The lifecycle — 12 phases, each a real Acceptance Act

Every phase folds through the existing engine using only the existing primitives
(6 check rules, 4 consequences, 4 outcomes). Money is paid on the **accepted**
(surveyed) quantity exactly as [`consequences.ts`](../../../packages/engine/src/consequences.ts).

| # | Phase | Gate | Scope | Reviewer | Money (BOQ rate) |
|---|-------|------|-------|----------|------|
| 1 | Design + permit | `construction.design-permit-acceptance` | BLDG | client | fixed €480 000 (design & survey works) |
| 2 | Advance 15% | `construction.advance-payment` | BLDG | client | fixed 15% under bank guarantee |
| 3 | Excavation pit | `construction.excavation-acceptance` | SITE | technical supervision | €18/m³ on surveyed pit (FER01-01-013) |
| 4 | Raft reinforcement (AOSR) | `construction.hidden-works-acceptance` †| BLDG-L00 | construction control | — (right to pour) |
| 5 | Raft C25/30 | `construction.work-volume-acceptance` †| BLDG-L00 | technical supervision | €85/m³ on survey (FER06-01-001-01) |
| 6 | Frame (storey×bay) | `construction.structure-acceptance` | bay | technical supervision | €140/m³ (FER06-01-015) |
| 7 | Façade / envelope | `construction.envelope-acceptance` | bay | technical supervision | €95/m² (FERm15-01) |
| 8 | MEP (engineering systems) | `construction.mep-acceptance` | bay | technical supervision | €120/m² + pressure test (FERm10-06) |
| 9 | Fit-out | `construction.fitout-acceptance` | bay | technical supervision | €60/m² (FER15-04-005) |
| 10 | Fire safety | `facilities.fire-safety-acceptance` †| bay | fire-safety inspector | — (right to occupancy) |
| 11 | Handover / ZOS / commissioning act | `construction.handover-and-release` | BLDG | client | lump 0 → triggers release |
| 12 | Guarantee retention release (2 tranches) | `construction.final-retention-release` | BLDG | client | 50% at handover, 50% +730 d |

† kept **verbatim** from the repo (`examples/construction/gate.json`,
`examples/construction/hidden-works/gate.json`, `examples/facilities/gate.json`).
The other gates live in [`gates/`](gates/). The BOQ/estimate rate table —
[`smeta.json`](smeta.json) — is the single rate source of truth; the two reused
gates' rates (€85, fit-out €60) match it exactly.

## The roles and the acts they exchange

Nine roles, each a real engine `actor`, exchange **17 real documents**
([`project.json`](project.json)): the contractor (site foreman) submits **KS-2**
(a `claim`); the surveyor supplies the **survey sheet /
as-built survey** that is the trusted `cross_check` reference; the lab
supplies **concrete / pressure-test / electrical-measurement reports** (`evidence`); construction control
signs the **AOSR** before a pour; the **technical supervision (technadzor)** accepts on the surveyed
quantity (a `decision`, → **KS-3** money); the **client** pays, accepts handover
(**ZOS** + **commissioning act**) and returns the **guarantee retention**. Authorities
and the bank only ever supply evidence — they never decide a gate (SPEC §10).

The claim-vs-reality reconciliation is structural, not an email argument: the
contractor's KS-2 claims slightly high, the survey reads the reference, and money
is certified on the **accepted** figure (`acceptedValues → surveyed → claim`).
51 cases exceed tolerance and are **returned for rework**, then corrected and
accepted with a visible schedule slip.

## What the engine produces — and the viewer reads

[`drive.ts`](drive.ts) folds everything and emits, into
[`viz/model/e2e/`](../../../viz/model/e2e/):

| File | What |
|------|------|
| `attachments.json` | per-zone works + documents (extended `ZoneAttachments`: who claimed/accepted, net, retention, payment-due, cycle days, doc class) |
| `timeline.json` | every engine event + per-zone accepted-stage history (drives the scrubber recolor) |
| `ledger.json` | 22 monthly **KS-3** periods, retention reserve, advance recovery |
| `certificate.json` | **EVM** (PV / EV / AC, SPI / CPI) + KS-3 line detail |
| `roles.json` | roles + acts catalog for the role lens |

## The shared control surface — `viz/viewer/control/`

One dependency-free page (the vendored three.js, no build step) that every role
opens to the **same** live building:

- the **3D model** (excavation pit → raft → 2 underground → 14 storeys → roof), coloured
  by what is **accepted** at time *t*;
- a **timeline scrubber** that replays the whole cycle from the real event
  timestamps — press ▶ and watch the building rise from the pit and the money
  accrue;
- a **role lens** (site foreman / technical supervision / developer / surveyor / laboratory) that
  re-highlights the model and refilters the acts feed;
- a **money / EVM dashboard** (certified KS-3, retention reserve, advance
  outstanding, PV/EV/AC S-curve, SPI/CPI) — all as-of *t*;
- a **click-a-zone panel** — its acts, who claimed/accepted/paid, the money, and
  the documents (AOSR / survey / report / …);
- a live **acts feed** — `claim → evidence → decision` as it fires.

The same `building.json` also still drives the original selector
(`viz/viewer/`) and the Remotion animation — one spatial source of truth.
