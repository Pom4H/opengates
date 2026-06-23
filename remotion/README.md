# Open Gates — README animations (Remotion)

Two compositions, both rendered to `../docs/media` and embedded in the root
`README.md`:

1. **`OpenGatesFlow`** — walks the construction **work-volume-acceptance** gate
   through its five steps (claim → evidence → checks → decision → consequence)
   using the exact numbers from [`examples/construction`](../examples/construction).
2. **`BuildingProgress`** — a react-three-fiber scene of a 9-storey, 4×3-block
   building built **diagonally**, block by block, by **four parallel systems**
   (structure → façade → MEP → fit-out) that trail one another in dependency
   order. It reads the canonical [`viz/model/building.json`](../viz/model) so it
   stays in sync with the interactive zone selector and the OBJ export.

## Regenerate

```bash
cd remotion
npm install

# Preview / edit both compositions live in the browser
npm run studio

# Re-render the committed assets into ../docs/media
npm run render       # open-gates-flow.mp4   (1280×720)
npm run render:gif   # open-gates-flow.gif   (1000×563, embedded in README)
npm run build:mp4    # building-progress.mp4 (1280×720)
npm run build:gif    # building-progress.gif (1000×563, embedded in README)
```

Rendering uses Remotion's headless Chromium (downloaded on first run). The flow
narrative lives in [`src/data.ts`](src/data.ts) and [`src/Flow.tsx`](src/Flow.tsx);
the building scene in [`src/building/`](src/building); shared palette/timing in
[`src/theme.ts`](src/theme.ts).
