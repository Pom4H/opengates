# Is an end-to-end construction realizable on Open Gates? — the verdict

> The hypothesis: *take a real building's drawings, estimates and documents and
> run the whole cycle — from design and the excavation pit to finishing works and
> received payments — as Open Gates Acceptance Acts, on the one 3D model every
> role uses.* This is the honest answer, backed by a working build:
> [`examples/construction/e2e/`](../examples/construction/e2e/).

## Verdict: **realizable, with the engine unchanged.**

The entire lifecycle — design+permit, 15% advance, excavation pit, foundation raft
(AOSR + raft), 384 bays × 4 parallel systems, fire-safety, handover (ZOS + commissioning
act) and the two-tranche retention release — is expressible as Acceptance Acts
that fold through the **existing** `fold` / `consequences` / `zones` modules with
**no engine, schema or check-rule change**. Confirmed end-to-end:

- **1 560 acceptance cases** folded (≈7 700 events, 2026-01 → 2029-10); 51 went
  through a real dispute → rework → accept cycle.
- **Money reproduces `consequences.ts` to the cent** — e.g. the raft: 1 036.8 m³
  × €85 = €88 128 gross, 5% = €4 406.40 retention, €83 721.60 net, €16 744.32 VAT
  memo.
- **Deterministic / replayable** — rerunning the simulator yields byte-identical
  output (no wall clock, no randomness).
- **72 engine unit tests still pass, conformance 5/5**, zone lint clean (every
  zone in the model, no duplicate acceptances).

## What is genuinely "physics" here — load-bearing and exact

The engine does **not** simulate forces; the "physics" it reproduces is the
**causal and economic structure** of a build — the part that is actually disputed,
paid and audited. All of this is load-bearing and exact:

1. **The acceptance boundary.** Every real milestone is the same typed step —
   `claim → evidence → checks → decision → consequences` — the one place a claim
   becomes a payable fact or is refused. A KS-2 (work-acceptance act) is a `claim`; a survey/report is
   `evidence`; the technical supervision (technadzor) signature is a role-bound `decision`.
2. **Claim vs. reality, metrology-honest.** `cross_check` measures the contractor's
   claim against the **surveyed reference** (VIM §2.16), with an absolute floor and
   the survey's expanded uncertainty `U` (GUM). Money is paid on the **accepted**
   quantity (`acceptedValues → surveyed → claim`), never the asserted one — the
   survey-vs-KS-2 argument made structural.
3. **Money is real.** Unit rate × accepted quantity, integer minor units, 5%
   guarantee retention (capped per acceptance), 20% VAT as a memo excluded from
   earned value, payment terms → due dates. It rolls up into 22 monthly **KS-3** (cost/payment certificate)
   certificates with advance recovery and a retention reserve.
4. **Process causality.** `right_to_proceed` chains the dependency graph —
   excavation unlocks the raft, the raft the frame, frame→envelope→MEP→fit-out per
   bay, fit-out + fire-safety gate handover, handover unlocks the retention
   release. The build sweep literally starts below grade (negative `arrival`) and
   rises.
5. **Event-sourced and auditable.** Acts are immutable, deduped, ordered facts;
   the same log always folds to the same state; every fired effect carries a stable
   `effectId` so a payment is exactly-once on replay.
6. **EVM from the folded state.** EV is literally `computeAmount` (net certified)
   on actual decision dates; PV is the planned baseline (the same lines on their
   on-time arrival dates), so the 51 disputed reworks surface as **SPI dipping to
   ~0.98 and recovering** — not a flat 1.00. AC is **illustrative** (actual
   contractor cost is the one figure the engine does not own; here EV inflated by a
   fixed overrun). The design fee (design & survey works) and the advance are pre-/non-construction
   lumps kept out of KS-3 earned value and BAC, so EV never exceeds the contract.
7. **Cross-domain, one place.** A facilities fire-safety acceptance anchors to the
   same bay as the construction work — different domain, same zone.

## What is approximated — and deliberately outside the engine

Stated plainly, so the claim is not oversold:

- **Geometry is axis-aligned boxes, not BIM/IFC.** The benched excavation pit is a few
  stacked translucent boxes; the raft and roof are slabs. There is **no FEA, no
  structural/thermal/clash analysis**. Concrete strength enters only as a
  *documentary* cross-check (the 28-day report), not a simulation. The pit
  *volume* that drives payment comes from the survey, so the box approximation never
  touches the money.
- **The KS-3 rollup layer is non-engine, by design.** Period assembly, advance
  recovery (advance offset), the retention reserve and the 50/50 release split live
  in the simulator's rollup, *aggregating* engine money-effects — never recomputing
  per-fact money. This keeps earned value clean (SPEC §6).
- **`retentionCap` is per-acceptance, not contract-cumulative** — that is the
  engine's semantics; a contract-wide ceiling is a rollup concern, flagged, not
  patched into the engine. (At this demo's scale the €25 000 cap never actually
  binds — the largest single retention is the excavation pit's €13 997 — so it is a
  semantic guard here, not a live constraint.)
- **Magnitudes are illustrative.** The unit rates match the repo exactly (raft €85,
  fit-out €60); the per-bay quantities are modest, so the headline €4 M is smaller
  than a real building's budget. The *mechanics* are real; the *scale* is a demo.
- **One naming convention beyond the engine.** Below-grade bays use a reserved
  `F90+` floor band (`F91`/`F92`) that still satisfies the existing zone regex
  verbatim; only the four building/site-level gates carry an opt-in relaxed
  `^(SITE|BLDG)...` pattern. Every pre-existing example, the original viewer, the
  Remotion animation and `lintZones` keep working unchanged.

## Where it goes next

The gaps above are the roadmap, not blockers:

- **As-built reality** — replace surveyed numbers with field-captured LiDAR/IFC, so
  "claim vs. reality" becomes literal geometry. The foundational design already
  exists: [`docs/architecture/spatial-evidence-and-ar.md`](architecture/spatial-evidence-and-ar.md).
- **Real KS-2/KS-3 PDFs** generated from the folded `attachments` / `certificate`.
- **Authority over the wire** — the engine already binds the reviewer role to an
  OAuth scope ([`docs/MCP.md`](MCP.md)); here the simulator folds directly.
- **Durable execution** — embed the fold as a deterministic step in Temporal /
  Inngest / Restate ([`docs/DURABLE-EXECUTION.md`](DURABLE-EXECUTION.md)).

## Bottom line

A real e2e construction — from project and pit to finishing and payments, with the
real Russian act flow (KS-2/KS-3, AOSR, survey, reports, ZOS, commissioning act,
guarantee retention) between the real roles — **is** faithfully representable as
Open Gates Acceptance Acts on one shared 3D model, driven entirely by the
unchanged engine. The thing the engine reproduces "in full" is the operation's
**acceptance physics**: who accepts what, against which reality, with which
consequence in money, schedule and liability. That is exactly the part of a build
that is fought over — and it is the part Open Gates makes verifiable.
