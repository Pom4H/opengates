# Spatial zones — the visualization layer

Open Gates binds an accepted fact to **money**, **time**, and — here — **place**.
When a claim carries a `zone` field (see [`SPEC.md`](../SPEC.md)), the gate points
at a spatial model and the claim is accepted against a concrete **zone**: one
block (*section × row × floor*) of a building.

![Building built diagonally, block by block, with four parallel systems](../docs/media/building-progress.gif)

## Grid of blocks, diagonal build, parallel systems

The building is a **grid** — `nx` columns (X) × `nz` rows (Z) × `floors`, over
`basements` below-grade levels, with a benched **excavation pit**, a **foundation
raft** and a roof. Each block on each level is one zone (e.g. `B2-F03` = column
B, row 2, floor 3; `B2-F91` = the same bay on basement −1). Site- and
building-level scopes (`SITE`, `BLDG-L00` raft, `BLDG-R01` roof) anchor the acts
that aren't per-bay. The canonical object is a 6×4 grid, 14 storeys + 2
basements — **389 zones**.

Construction runs **diagonally** (a zone's `arrival` orders the sweep across the
plan and up the floors) and in **four parallel systems**, each trailing the one
it depends on by a fixed `lag` — so the dependency between systems is visible as
four colour waves chasing each other through the grid:

| # | system | colour | depends on |
|--:|--------|--------|------------|
| 1 | structure | gray | — |
| 2 | envelope (façade) | blue | structure |
| 3 | MEP | amber | envelope |
| 4 | fit-out (accepted) | green | MEP |

A block's colour is how many systems have reached it (`systemsDone`, 0–4).

## One source of truth

Everything reads the same canonical file, so the selector, the OBJ export and the
animation never disagree:

```
viz/model/generate.ts   →   building.json   (canonical)
                            building.obj + .mtl   (interchange / OBJ export)
```

- **`building.json`** — `grid`, `block`, the `systems` (with colours + lags),
  `build` timing, a `palette`, and a flat list of **zones**. Each zone has an
  `id`, grid coords (`col`/`row`/`floor`), an `arrival` (diagonal order),
  `systemsDone` for the exported snapshot, and the `structure` box + `glazing`
  panels (one per exposed face) in metres.
- **`building.obj` / `.mtl`** — the same geometry exported as OBJ, grouped per
  zone (`g B2-F03-structure`) with a material per system level, for any external
  3D tool.

Regenerate (snapshot fraction `p`, 0→1 through the whole build):

```bash
node viz/model/generate.ts            # default snapshot (p=0.62)
node viz/model/generate.ts --p=0.85   # further along
```

## Attachments — work & documents on a zone

A zone is an **anchor**: works (gate cases) and documents (evidence) attach to it.
The engine inverts the claim→zone link with `indexByZone` and the
`viz:attachments` script writes the result to **`viz/model/attachments.json`**
(zone id → works + documents + acceptance rollup). The viewer loads it (if
present) and shows, for the selected zone, the real work anchored there:

```bash
npm run viz:attachments      # from the repo root → viz/model/attachments.json
```

A zone is **cross-domain**: construction systems *and* a facilities fire-safety
acceptance ([`examples/facilities/`](../examples/facilities)) anchor to the same
zone, and `demo:zone` validates every referenced zone against this model
(`lintZones` — flags unknown zones and double acceptances). See
[`examples/construction/systems/`](../examples/construction/systems) and
[`SPEC.md` §7.5](../SPEC.md).

## Interactive zone selector

A self-contained three.js viewer (three is **vendored** under `viewer/vendor/`,
so it works offline — no CDN). Click a zone to select it; the panel shows the
works and documents attached to it (from `attachments.json`), and clicking again
advances the snapshot a system. Glazing appears once the envelope is in.

```bash
python3 -m http.server 8099      # from the repo root
# open http://localhost:8099/viz/viewer/
```

## End-to-end control surface

The same `building.json` drives a full-lifecycle **operational cockpit** every
role shares — the 3D object (excavation pit → raft → basements → storeys → roof)
coloured by what's **accepted** over a **timeline scrubber**, a **role lens**, a
**KS-3 / EVM** money dashboard, a click-a-zone act panel and a live acts feed.
A deterministic simulator folds the whole project (design → excavation pit → frame →
fit-out → handover → payments, ~1 560 acceptance cases) through the **unchanged**
engine and emits the data it reads:

```bash
node examples/construction/e2e/drive.ts    # → viz/model/e2e/{attachments,timeline,ledger,certificate,roles}.json
python3 -m http.server 8099                # open http://localhost:8099/viz/viewer/control/
```

Walkthrough: [`examples/construction/e2e/`](../examples/construction/e2e/) ·
verdict: [`docs/e2e-feasibility.md`](../docs/e2e-feasibility.md).

## Resource flow — the "out of what" view

The spatial view shows *what is built*; the **flow view** ([`viz/flow/`](flow/))
shows the resources it was built from — materials, people and rented machines
flowing in, each edge a gate, drawn down into the zone's systems. It reads two
projection files written from accepted facts (the flow siblings of
`attachments.json`):

```bash
npm run viz:flows      # writes viz/model/flows.json + ledger.json
python3 -m http.server 8099    # then open /viz/flow/
```

The graph (`flowGraph`), the per-resource mass balance (`resourceLedger`) and the
cross-case lint (`lintFlows`) live in
[`packages/engine/src/flows.ts`](../packages/engine/src/flows.ts); the worked
cross-domain path is [`examples/operations/`](../examples/operations). Design:
[`docs/architecture/resource-flow-and-domains.md`](../docs/architecture/resource-flow-and-domains.md).

## Animation

The README hero (`docs/media/building-progress.gif` / `.mp4`) is captured straight
from the **control surface** above — the whole e2e build replayed from the engine
timeline (excavation → tower → fit-out), with the tower crane climbing the work
front. To re-record it: open `/viz/viewer/control/?hq=1&capture=1`, then drive the
`window.__viz.setT` hook frame-by-frame and assemble with `ffmpeg`.

Remotion + react-three-fiber (`remotion/`) renders an alternate, lighter
systems-wave clip from the same `building.json`. See [`remotion/`](../remotion/README.md)
and the [`building-viz`](../.claude/skills/building-viz/SKILL.md) skill.
