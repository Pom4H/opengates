// Open Gates — spatial model generator.
//
// One canonical source of truth for a building, consumed by every renderer so
// the interactive selector, the OBJ export and the Remotion animation always
// agree.
//
// The building is a GRID of blocks: NX columns (X) × NZ rows (Z) × FLOORS, plus
// a BELOW-GRADE reality — a benched excavation pit, a foundation raft
// and two basement levels — and a roof/plant level. A
// "zone" is one block on one level — the spatial unit a claim is bound to.
//
// Construction runs DIAGONALLY and in PARALLEL SYSTEMS. Each system (structure,
// envelope, MEP, fit-out) sweeps the same diagonal order but trails the one it
// depends on by a fixed lag, so the dependency between systems is visible. The
// sweep STARTS underground (basements have negative arrival) and rises. Run:
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
export type Level = "excavation" | "foundation" | "basement" | "grade" | "roof" | "marker";

export type Zone = {
  id: string; // e.g. "B2-F03" (storey 3), "A1-F91" (basement −1), "SITE", "BLDG-L00"
  col: string; // "A".."F" (along X) — bays only
  row: number; // 1..NZ (along Z) — bays only
  bx: number;
  bz: number;
  floor: number; // 1..FLOORS above grade; 91/92 below grade; 0 for non-bay scopes
  arrival: number; // structure arrival in build-units (diagonal order; negative below grade)
  systemsDone: number; // 0..4 in the exported snapshot
  structure: Box;
  glazing: GlassPanel[]; // exposed (perimeter) faces only
  level?: Level; // additive: which slice of the object this zone belongs to
  scope?: "bay" | "site" | "building"; // additive: anchoring scope
};

export type SystemDef = { id: string; name: string; color: string; lag: number };

export type BuildingModel = {
  name: string;
  units: "m";
  grid: { nx: number; nz: number; floors: number; basements: number };
  block: { w: number; d: number; h: number };
  systems: SystemDef[];
  build: {
    diagStep: number;
    floorStep: number;
    ramp: number;
    minArrival: number;
    maxArrival: number;
  };
  base: Box;
  palette: Record<string, string>;
  zones: Zone[];
};

// --- geometry parameters (metres) ------------------------------------------
const NX = 6;
const NZ = 4;
const FLOORS = 14;
const BASEMENTS = 2;
const BW = 6; // block width  (X)
const BD = 6; // block depth  (Z)
const FH = 3.4; // storey height (Y)
const GAP = 0.16; // gap between blocks so the grid reads
const GLASS_T = 0.14;

// Below-grade datums (grade = ground-floor slab top = Y 0).
const GRADE = 0;
const GROUND_SLAB = 0.2; // basement −1 ceiling sits this far below grade
const BFH = [3.4, 3.6]; // clear heights of B-1, B-2
const FND_T = 1.2; // foundation raft thickness
const PIT_BENCH = 6; // excavation pit extends this far beyond the footprint
const PIT_BOTTOM = -9.0; // working bottom of the pit (below the mat)

const COLS = ["A", "B", "C", "D", "E", "F"];

const PALETTE = {
  not_started: "#2a313d",
  structure: "#8a93a3", // 1 — frame up
  envelope: "#7fd4ff", // 2 — façade / glazing
  mep: "#f5a524", // 3 — mechanical / electrical / plumbing
  fitout: "#34d399", // 4 — fit-out → accepted
  glazing: "#7fd4ff",
  base: "#202833",
  excavation: "#6b5a43", // excavation pit / earth
  foundation_mat: "#5b6675", // foundation raft
  roof: "#46566a", // roof / plant
  selected: "#22d3ee",
};

// Derived below-grade level Y ranges.
const B1_TOP = GRADE - GROUND_SLAB; // -0.2
const B1_BOT = B1_TOP - BFH[0]; // -3.6
const B2_TOP = B1_BOT; // -3.6
const B2_BOT = B2_TOP - BFH[1]; // -7.2
const FND_TOP = B2_BOT; // -7.2
const FND_BOT = FND_TOP - FND_T; // -8.4
const BASEMENT_Y: Record<number, [number, number]> = {
  1: [B1_BOT, B1_TOP], // F91 = B-1
  2: [B2_BOT, B2_TOP], // F92 = B-2
};

// Diagonal-order + dependency timing, in abstract "build units".
const maxDiag = NX - 1 + (NZ - 1);
const DIAG_STEP = 1;
const FLOOR_STEP = (maxDiag + 1) * 0.6; // levels overlap ~40%
const RAMP = 1.2; // build-units for one system to finish a cell

const SYSTEMS: SystemDef[] = [
  { id: "structure", name: "Structure", color: PALETTE.structure, lag: 0 },
  { id: "envelope", name: "Envelope (façade)", color: PALETTE.envelope, lag: FLOOR_STEP * 1.4 },
  { id: "mep", name: "MEP", color: PALETTE.mep, lag: FLOOR_STEP * 2.6 },
  { id: "fitout", name: "Fit-out", color: PALETTE.fitout, lag: FLOOR_STEP * 3.8 },
];

// Build sweep spans from the deepest basement corner to the top storey.
const MIN_ARRIVAL = -BASEMENTS * FLOOR_STEP;
const maxStructArrival = (FLOORS - 1) * FLOOR_STEP + maxDiag * DIAG_STEP;
const MAX_ARRIVAL = maxStructArrival + SYSTEMS[SYSTEMS.length - 1].lag + RAMP;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Glazing on exposed (perimeter) faces, given a bay origin and its Y range.
function perimeterGlazing(x0: number, z0: number, bx: number, bz: number, y0: number, y1: number): GlassPanel[] {
  const g: GlassPanel[] = [];
  const gy0 = y0 + 0.55;
  const gy1 = y1 - (y1 - y0) * 0.18;
  if (bx === 0)
    g.push({ face: "x-", box: { min: [x0 + GAP - 0.02, gy0, z0 + GAP + 0.4], max: [x0 + GAP + GLASS_T, gy1, z0 + BD - GAP - 0.4] } });
  if (bx === NX - 1)
    g.push({ face: "x+", box: { min: [x0 + BW - GAP - GLASS_T, gy0, z0 + GAP + 0.4], max: [x0 + BW - GAP + 0.02, gy1, z0 + BD - GAP - 0.4] } });
  if (bz === 0)
    g.push({ face: "z-", box: { min: [x0 + GAP + 0.4, gy0, z0 + GAP - 0.02], max: [x0 + BW - GAP - 0.4, gy1, z0 + GAP + GLASS_T] } });
  if (bz === NZ - 1)
    g.push({ face: "z+", box: { min: [x0 + GAP + 0.4, gy0, z0 + BD - GAP - GLASS_T], max: [x0 + BW - GAP - 0.4, gy1, z0 + BD - GAP + 0.02] } });
  return g;
}

function systemsDoneAt(arrival: number, p: number): number {
  let n = 0;
  for (const s of SYSTEMS) if (p >= arrival + s.lag + RAMP) n++;
  return n;
}

function buildModel(p01: number): BuildingModel {
  const totalX = NX * BW;
  const totalZ = NZ * BD;
  const x0g = -totalX / 2;
  const z0g = -totalZ / 2;
  // p sweeps from the deepest basement corner to the finished roof.
  const p = MIN_ARRIVAL + p01 * (MAX_ARRIVAL - MIN_ARRIVAL);

  const zones: Zone[] = [];

  for (let bx = 0; bx < NX; bx++) {
    for (let bz = 0; bz < NZ; bz++) {
      const x0 = x0g + bx * BW;
      const z0 = z0g + bz * BD;
      const diag = (bx + bz) * DIAG_STEP;

      // Below-grade bays: basements build first (negative arrival), no glazing.
      for (let k = BASEMENTS; k >= 1; k--) {
        const [yb, yt] = BASEMENT_Y[k];
        const arrival = -k * FLOOR_STEP + diag;
        zones.push({
          id: `${COLS[bx]}${bz + 1}-F${String(90 + k).padStart(2, "0")}`,
          col: COLS[bx],
          row: bz + 1,
          bx,
          bz,
          floor: 90 + k,
          arrival,
          systemsDone: systemsDoneAt(arrival, p),
          structure: { min: [x0 + GAP, yb + 0.12, z0 + GAP], max: [x0 + BW - GAP, yt - 0.08, z0 + BD - GAP] },
          glazing: [],
          level: "basement",
          scope: "bay",
        });
      }

      // Above-grade storeys.
      for (let f = 1; f <= FLOORS; f++) {
        const y0 = (f - 1) * FH;
        const arrival = (f - 1) * FLOOR_STEP + diag;
        zones.push({
          id: `${COLS[bx]}${bz + 1}-F${String(f).padStart(2, "0")}`,
          col: COLS[bx],
          row: bz + 1,
          bx,
          bz,
          floor: f,
          arrival,
          systemsDone: systemsDoneAt(arrival, p),
          structure: { min: [x0 + GAP, y0 + 0.16, z0 + GAP], max: [x0 + BW - GAP, y0 + FH * 0.94, z0 + GAP + BD - 2 * GAP] },
          glazing: perimeterGlazing(x0, z0, bx, bz, y0, y0 + FH),
          level: "grade",
          scope: "bay",
        });
      }
    }
  }

  // --- site / building-level scope zones (anchors for excavation pit / raft / roof) ---
  const footMinX = x0g, footMaxX = x0g + totalX;
  const footMinZ = z0g, footMaxZ = z0g + totalZ;
  const siteBox = (inset: number, yb: number, yt: number): Box => ({
    min: [footMinX - inset, yb, footMinZ - inset],
    max: [footMaxX + inset, yt, footMaxZ + inset],
  });

  // Excavation pit — benched (wider at top), drawn as the excavated envelope. The pit
  // is built first of all; its arrival is the earliest in the sweep.
  const pitArrival = MIN_ARRIVAL - FLOOR_STEP;
  zones.push({
    id: "SITE",
    col: "", row: 0, bx: -1, bz: -1, floor: 0,
    arrival: pitArrival,
    systemsDone: p >= pitArrival + RAMP ? 1 : 0,
    structure: siteBox(PIT_BENCH, PIT_BOTTOM, GRADE),
    glazing: [],
    level: "excavation",
    scope: "site",
  });
  zones.push({
    id: "SITE-B02",
    col: "", row: 0, bx: -1, bz: -1, floor: 0,
    arrival: pitArrival,
    systemsDone: p >= pitArrival + RAMP ? 1 : 0,
    structure: siteBox(PIT_BENCH * 0.45, PIT_BOTTOM, B2_BOT),
    glazing: [],
    level: "excavation",
    scope: "site",
  });

  // Foundation raft — the raft slab over the whole footprint.
  const fndArrival = MIN_ARRIVAL - 0.4 * FLOOR_STEP;
  zones.push({
    id: "BLDG-L00",
    col: "", row: 0, bx: -1, bz: -1, floor: 0,
    arrival: fndArrival,
    systemsDone: p >= fndArrival + RAMP ? 1 : 0,
    structure: { min: [footMinX + 0.3, FND_BOT, footMinZ + 0.3], max: [footMaxX - 0.3, FND_TOP, footMaxZ - 0.3] },
    glazing: [],
    level: "foundation",
    scope: "building",
  });

  // Roof / plant — a thin slab + parapet over the top storey, with a plant box.
  const roofY = FLOORS * FH; // 47.6
  const roofArrival = maxStructArrival;
  zones.push({
    id: "BLDG-R01",
    col: "", row: 0, bx: -1, bz: -1, floor: 0,
    arrival: roofArrival,
    systemsDone: p >= roofArrival + RAMP ? 1 : 0,
    structure: { min: [footMinX + GAP, roofY, footMinZ + GAP], max: [footMaxX - GAP, roofY + 0.4, footMaxZ - GAP] },
    glazing: [],
    level: "roof",
    scope: "building",
  });
  zones.push({
    id: "BLDG-R02",
    col: "", row: 0, bx: -1, bz: -1, floor: 0,
    arrival: roofArrival,
    systemsDone: p >= roofArrival + RAMP ? 1 : 0,
    structure: { min: [x0g + totalX * 0.32, roofY + 0.4, z0g + totalZ * 0.3], max: [x0g + totalX * 0.62, roofY + 3.4, z0g + totalZ * 0.62] },
    glazing: [],
    level: "roof",
    scope: "building",
  });

  // Whole-object anchor for building-level acceptance acts (design/permit,
  // advance, handover, retention release). A marker, not rendered geometry, so
  // knownZoneIds()/lintZones recognise the BLDG scope.
  zones.push({
    id: "BLDG",
    col: "", row: 0, bx: -1, bz: -1, floor: 0,
    arrival: MIN_ARRIVAL, systemsDone: 0,
    structure: { min: [0, 0, 0], max: [0, 0, 0] },
    glazing: [],
    level: "marker",
    scope: "building",
  });

  // The podium / grade slab the building stands on (kept at Y≤0 so the viewer
  // ground plane and camera framing still work).
  const base: Box = {
    min: [x0g - 0.6, FND_BOT, z0g - 0.6],
    max: [x0g + totalX + 0.6, 0.0, z0g + totalZ + 0.6],
  };

  return {
    name: `${FLOORS}-storey block · ${NX}×${NZ} grid · ${BASEMENTS} basements + excavation pit + roof · parallel systems`,
    units: "m",
    grid: { nx: NX, nz: NZ, floors: FLOORS, basements: BASEMENTS },
    block: { w: BW, d: BD, h: FH },
    systems: SYSTEMS,
    build: { diagStep: DIAG_STEP, floorStep: FLOOR_STEP, ramp: RAMP, minArrival: pitArrival, maxArrival: MAX_ARRIVAL },
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

// Non-bay scope zones export with their own material, not a systems colour.
function mtlForZone(z: Zone): string {
  if (z.level === "excavation") return "excavation";
  if (z.level === "foundation") return "foundation_mat";
  if (z.level === "roof") return "roof";
  return SYS_MTL[z.systemsDone];
}

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
    emit(`${z.id}-structure`, z.structure, mtlForZone(z));
    if (z.scope === "bay" && z.systemsDone >= 2)
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
    mtlLines.push(`newmtl ${name}`, `Kd ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`, name === "glazing" || name === "excavation" ? "d 0.45" : "d 1.0", "");
  }
  return { obj: out.join("\n") + "\n", mtl: mtlLines.join("\n") + "\n" };
}

// --- CLI -------------------------------------------------------------------
const pArg = process.argv.find((a) => a.startsWith("--p="));
const p01 = clamp01(pArg ? Number(pArg.split("=")[1]) : 0.62);
const model = buildModel(p01);
const { obj, mtl } = toObj(model);

writeFileSync(join(HERE, "building.json"), JSON.stringify(model, null, 2) + "\n");
writeFileSync(join(HERE, "building.obj"), obj);
writeFileSync(join(HERE, "building.mtl"), mtl);

const bays = model.zones.filter((z) => z.scope === "bay").length;
const scopes = model.zones.filter((z) => z.scope !== "bay").length;
const built = model.zones.filter((z) => z.systemsDone > 0).length;
console.log(
  `Wrote building.json / building.obj / building.mtl — ` +
    `${model.zones.length} zones (${bays} bays across ${NX}×${NZ}×${FLOORS}+${BASEMENTS} basements + ${scopes} site/building scopes), ` +
    `${built} built at p=${p01.toFixed(2)}, ${SYSTEMS.length} parallel systems`,
);
