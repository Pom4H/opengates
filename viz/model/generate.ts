// Open Gates — spatial model generator.
//
// One canonical source of truth for a building, consumed by every renderer so
// the interactive selector, the OBJ export and the Remotion animation always
// agree.
//
// The building is a GRID of blocks: NX columns (X) × NZ rows (Z) × FLOORS.
// A "zone" is one block on one floor — the spatial unit a claim is bound to.
//
// Construction runs DIAGONALLY and in PARALLEL SYSTEMS. Each system (structure,
// envelope, MEP, fit-out) sweeps the same diagonal order but trails the one it
// depends on by a fixed lag, so the dependency between systems is visible. Run:
//
//   node viz/model/generate.ts                 # default mid-progress snapshot
//   node viz/model/generate.ts --p=0.8         # snapshot further along (0..1)
//
// Emits building.json (canonical), building.obj + building.mtl (interchange).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

export type Vec3 = [number, number, number];
export type Box = { min: Vec3; max: Vec3 };
export type GlassPanel = { face: "x-" | "x+" | "z-" | "z+"; box: Box };

export type Zone = {
  id: string; // e.g. "B2-F03"
  col: string; // "A".."D" (along X)
  row: number; // 1..NZ (along Z)
  bx: number;
  bz: number;
  floor: number; // 1..FLOORS
  arrival: number; // structure arrival in build-units (diagonal order)
  systemsDone: number; // 0..4 in the exported snapshot
  structure: Box;
  glazing: GlassPanel[]; // exposed (perimeter) faces only
};

export type SystemDef = { id: string; name: string; color: string; lag: number };

export type BuildingModel = {
  name: string;
  units: "m";
  grid: { nx: number; nz: number; floors: number };
  block: { w: number; d: number; h: number };
  systems: SystemDef[];
  build: {
    diagStep: number;
    floorStep: number;
    ramp: number;
    maxArrival: number;
  };
  base: Box;
  palette: Record<string, string>;
  zones: Zone[];
};

// --- geometry parameters (metres) ------------------------------------------
const NX = 4;
const NZ = 3;
const FLOORS = 9;
const BW = 4; // block width  (X)
const BD = 4; // block depth  (Z)
const FH = 3.2; // floor height (Y)
const GAP = 0.16; // gap between blocks so the grid reads
const GLASS_T = 0.14;

const COLS = ["A", "B", "C", "D", "E", "F"];

const PALETTE = {
  not_started: "#2a313d",
  structure: "#8a93a3", // 1 — frame up
  envelope: "#7fd4ff", // 2 — façade / glazing
  mep: "#f5a524", // 3 — mechanical / electrical / plumbing
  fitout: "#34d399", // 4 — fit-out → accepted
  glazing: "#7fd4ff",
  base: "#202833",
  selected: "#22d3ee",
};

// Diagonal-order + dependency timing, in abstract "build units".
const maxDiag = NX - 1 + (NZ - 1);
const DIAG_STEP = 1;
const FLOOR_STEP = (maxDiag + 1) * 0.6; // floors overlap ~40%
const RAMP = 1.2; // build-units for one system to finish a cell

const SYSTEMS: SystemDef[] = [
  { id: "structure", name: "Structure", color: PALETTE.structure, lag: 0 },
  { id: "envelope", name: "Envelope (façade)", color: PALETTE.envelope, lag: FLOOR_STEP * 1.4 },
  { id: "mep", name: "MEP", color: PALETTE.mep, lag: FLOOR_STEP * 2.6 },
  { id: "fitout", name: "Fit-out", color: PALETTE.fitout, lag: FLOOR_STEP * 3.8 },
];

const maxStructArrival = (FLOORS - 1) * FLOOR_STEP + maxDiag * DIAG_STEP;
const MAX_ARRIVAL = maxStructArrival + SYSTEMS[SYSTEMS.length - 1].lag + RAMP;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function buildModel(p01: number): BuildingModel {
  const totalX = NX * BW;
  const totalZ = NZ * BD;
  const x0g = -totalX / 2;
  const z0g = -totalZ / 2;
  const p = p01 * MAX_ARRIVAL;

  const zones: Zone[] = [];
  for (let bx = 0; bx < NX; bx++) {
    for (let bz = 0; bz < NZ; bz++) {
      for (let f = 1; f <= FLOORS; f++) {
        const x0 = x0g + bx * BW;
        const z0 = z0g + bz * BD;
        const y0 = (f - 1) * FH;
        const structure: Box = {
          min: [x0 + GAP, y0 + 0.16, z0 + GAP],
          max: [x0 + BW - GAP, y0 + FH * 0.94, z0 + BD - GAP],
        };

        // Glazing only on exposed (perimeter) faces.
        const glazing: GlassPanel[] = [];
        const gy0 = y0 + 0.55;
        const gy1 = y0 + FH * 0.82;
        if (bx === 0)
          glazing.push({ face: "x-", box: { min: [x0 + GAP - 0.02, gy0, z0 + GAP + 0.4], max: [x0 + GAP + GLASS_T, gy1, z0 + BD - GAP - 0.4] } });
        if (bx === NX - 1)
          glazing.push({ face: "x+", box: { min: [x0 + BW - GAP - GLASS_T, gy0, z0 + GAP + 0.4], max: [x0 + BW - GAP + 0.02, gy1, z0 + BD - GAP - 0.4] } });
        if (bz === 0)
          glazing.push({ face: "z-", box: { min: [x0 + GAP + 0.4, gy0, z0 + GAP - 0.02], max: [x0 + BW - GAP - 0.4, gy1, z0 + GAP + GLASS_T] } });
        if (bz === NZ - 1)
          glazing.push({ face: "z+", box: { min: [x0 + GAP + 0.4, gy0, z0 + BD - GAP - GLASS_T], max: [x0 + BW - GAP - 0.4, gy1, z0 + BD - GAP + 0.02] } });

        const arrival = (f - 1) * FLOOR_STEP + (bx + bz) * DIAG_STEP;
        let systemsDone = 0;
        for (const s of SYSTEMS) if (p >= arrival + s.lag + RAMP) systemsDone++;

        zones.push({
          id: `${COLS[bx]}${bz + 1}-F${String(f).padStart(2, "0")}`,
          col: COLS[bx],
          row: bz + 1,
          bx,
          bz,
          floor: f,
          arrival,
          systemsDone,
          structure,
          glazing,
        });
      }
    }
  }

  const base: Box = {
    min: [x0g - 0.6, -0.7, z0g - 0.6],
    max: [x0g + totalX + 0.6, 0.0, z0g + totalZ + 0.6],
  };

  return {
    name: `${FLOORS}-storey block · ${NX}×${NZ} grid · parallel systems`,
    units: "m",
    grid: { nx: NX, nz: NZ, floors: FLOORS },
    block: { w: BW, d: BD, h: FH },
    systems: SYSTEMS,
    build: { diagStep: DIAG_STEP, floorStep: FLOOR_STEP, ramp: RAMP, maxArrival: MAX_ARRIVAL },
    base,
    palette: PALETTE,
    zones,
  };
}

// --- OBJ / MTL export ------------------------------------------------------
function boxFaces(b: Box, base: number): { verts: Vec3[]; faces: number[][] } {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const verts: Vec3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const q = (a: number, b2: number, c: number, d: number) => [base + a, base + b2, base + c, base + d];
  const faces = [q(1, 2, 3, 4), q(5, 8, 7, 6), q(1, 5, 6, 2), q(2, 6, 7, 3), q(3, 7, 8, 4), q(4, 8, 5, 1)];
  return { verts, faces };
}

const SYS_MTL = ["not_started", "structure", "envelope", "mep", "fitout"];

function toObj(m: BuildingModel): { obj: string; mtl: string } {
  const out: string[] = ["# Open Gates building — generated by viz/model/generate.ts", "mtllib building.mtl"];
  let vbase = 0;
  const emit = (name: string, b: Box, mtl: string) => {
    const { verts, faces } = boxFaces(b, vbase);
    out.push(`g ${name}`, `usemtl ${mtl}`);
    for (const v of verts) out.push(`v ${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2].toFixed(3)}`);
    for (const f of faces) out.push(`f ${f[0]} ${f[1]} ${f[2]} ${f[3]}`);
    vbase += verts.length;
  };

  emit("base", m.base, "base");
  for (const z of m.zones) {
    if (z.systemsDone === 0) continue; // not yet built in this snapshot
    emit(`${z.id}-structure`, z.structure, SYS_MTL[z.systemsDone]);
    if (z.systemsDone >= 2)
      z.glazing.forEach((g, i) => emit(`${z.id}-glass${i}`, g.box, "glazing"));
  }

  const hex = (h: string): Vec3 => [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  ];
  const mtlLines: string[] = ["# Open Gates building materials"];
  for (const [name, h] of Object.entries(m.palette)) {
    const [r, g, b] = hex(h);
    mtlLines.push(`newmtl ${name}`, `Kd ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`, name === "glazing" ? "d 0.45" : "d 1.0", "");
  }
  return { obj: out.join("\n") + "\n", mtl: mtlLines.join("\n") + "\n" };
}

// --- CLI -------------------------------------------------------------------
const pArg = process.argv.find((a) => a.startsWith("--p="));
const p01 = clamp01(pArg ? Number(pArg.split("=")[1]) : 0.58);
const model = buildModel(p01);
const { obj, mtl } = toObj(model);

writeFileSync(join(HERE, "building.json"), JSON.stringify(model, null, 2) + "\n");
writeFileSync(join(HERE, "building.obj"), obj);
writeFileSync(join(HERE, "building.mtl"), mtl);

const built = model.zones.filter((z) => z.systemsDone > 0).length;
console.log(
  `Wrote building.json / building.obj / building.mtl — ` +
    `${model.zones.length} zones (${NX}×${NZ}×${FLOORS}), ${built} built at p=${p01.toFixed(2)}, ` +
    `${SYSTEMS.length} parallel systems`,
);
