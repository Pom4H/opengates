---
name: building-viz
description: Inspect and modify the Open Gates spatial building model (zones, statuses, glazing) and render it via three.js — an interactive selector, an OBJ export, or a construction-progress animation. Use when asked to visualize a building, bind a claim to a zone, mark zones complete, or regenerate the building render/GIF.
allowed-tools: Bash, Read, Edit, Write
---

# Building visualization

Open Gates can bind an accepted fact to a **zone** in space, not just to money
and time. The spatial layer lives in [`viz/`](../../../viz) and has **one
canonical source of truth** — `viz/model/building.json` — so the interactive
selector, the OBJ export and the animation never disagree.

The building is a **grid** of blocks — `nx`×`nz` per floor, `floors` high. A
**zone** is one block on one floor (e.g. `B2-F03` = column B, row 2, floor 3) —
the unit a claim is accepted against. Construction runs **diagonally** and in
**four parallel systems** that each trail the one they depend on:

1. `structure` (gray) → 2. `envelope`/façade (blue) → 3. `mep` (amber) →
4. `fit-out` (green = accepted)

Each zone has:

- `systemsDone`: how many systems are complete in the exported snapshot (0–4)
- `arrival`: its position in the diagonal build order (build-units)
- `col` / `row` / `floor`, and the `structure` box + `glazing` panels (metres)

## Files

| File | Role |
|---|---|
| `viz/model/generate.ts` | Generator: writes the three artifacts below |
| `viz/model/building.json` | **Canonical** model — edit statuses here |
| `viz/model/building.obj` + `.mtl` | OBJ interchange export (grouped per zone) |
| `viz/viewer/index.html` | Interactive three.js zone selector (vendored three) |
| `remotion/src/building/` | Construction-progress animation (Remotion + three) |

## Common tasks

**Regenerate the model** (snapshot fraction `p`, 0→1 through the whole build):

```bash
node viz/model/generate.ts            # default snapshot (p=0.62)
node viz/model/generate.ts --p=0.85   # further along
```

The canonical model is a mid-rise: a benched **excavation pit**, a **foundation
raft**, 2 basements (`F91`/`F92`), 14 storeys and a roof — 389 zones, with
site/building scopes (`SITE`, `BLDG-L00`, `BLDG-R01`). For the **full end-to-end
project** (design → excavation pit → … → payments) folded through the engine and shown
in the shared control surface, see
[`examples/construction/e2e/`](../../../examples/construction/e2e/) — run
`node examples/construction/e2e/drive.ts`, then open `/viz/viewer/control/`.

**Mark a specific zone** (bind it to a decision) — edit `building.json`: find the
zone by `id` and set its `systemsDone` (0–4). Re-run the generator if you want
the OBJ export to match a uniform progress snapshot; for arbitrary per-zone edits
change `building.json` directly.

**See what's attached to a zone** (works + documents, anchored via the claim's
zone field). The engine inverts claim→zone with `indexByZone`:

```bash
npm run demo:zone          # prints zone A1-F03's works, documents, rollup
npm run viz:attachments    # writes viz/model/attachments.json for the viewer
```

The worked example is [`examples/construction/systems/`](../../../examples/construction/systems)
(four parallel systems on one zone). See `packages/engine/src/zones.ts` and SPEC §7.5.

**Open the interactive selector** (click a zone to select and see its attached
work & documents, click again to advance the snapshot a system; the viewer is
self-contained and needs no network):

```bash
python3 -m http.server 8099    # from the repo root, then open
# http://localhost:8099/viz/viewer/
```

**Re-render the animation** (claim/zone story; outputs to `docs/media/`):

```bash
cd remotion && npm install
npm run build:gif      # building-progress.gif (embedded in README)
npm run build:mp4      # building-progress.mp4
npm run studio         # live-edit both compositions in the browser
```

## Rendering for the user

You cannot screenshot a live WebGL canvas reliably in a headless container, but
you **can** render deterministic frames and GIFs with Remotion (it ships its own
Chromium). To show a still:

```bash
cd remotion
npx remotion still src/index.ts BuildingProgress /tmp/frame.png --frame=210
```

Then surface the PNG/GIF to the user. Keep `building.json` as the single source
when changing what is shown — the animation and viewer both read it.
