// Loads the canonical building model and exposes the parallel-systems wave
// math so the animation stays in sync with viz/model/building.json.

import building from "../../../viz/model/building.json";

export type Vec3 = [number, number, number];
export type Box = { min: Vec3; max: Vec3 };
export type GlassPanel = { face: string; box: Box };
export type Zone = {
  id: string;
  col: string;
  row: number;
  bx: number;
  bz: number;
  floor: number;
  arrival: number;
  structure: Box;
  glazing: GlassPanel[];
};
export type SystemDef = { id: string; name: string; color: string; lag: number };
export type Model = {
  name: string;
  grid: { nx: number; nz: number; floors: number };
  block: { w: number; d: number; h: number };
  systems: SystemDef[];
  build: { diagStep: number; floorStep: number; ramp: number; maxArrival: number };
  base: Box;
  palette: Record<string, string>;
  zones: Zone[];
};

export const MODEL = building as unknown as Model;

export const center = (b: Box): Vec3 => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2,
];
export const size = (b: Box): Vec3 => [
  b.max[0] - b.min[0],
  b.max[1] - b.min[1],
  b.max[2] - b.min[2],
];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * State of one zone at global wave position `p` (build-units). Each system
 * trails the one it depends on by its `lag`, so the systems sweep the same
 * diagonal in parallel. `reached` counts systems that have started here (drives
 * the colour); `glass` is the envelope system's progress.
 */
export function zoneState(zone: Zone, p: number) {
  const { ramp } = MODEL.build;
  const sys = MODEL.systems;
  let reached = 0;
  let done = 0;
  const prog = sys.map((s) => {
    const v = clamp01((p - (zone.arrival + s.lag)) / ramp);
    if (v > 0) reached++;
    if (v >= 0.999) done++;
    return v;
  });
  const envelopeIdx = sys.findIndex((s) => s.id === "envelope");
  return {
    rise: prog[0],
    reached, // 0..4
    done, // 0..4
    glass: envelopeIdx >= 0 ? prog[envelopeIdx] : 0,
    visible: prog[0] > 0.001,
  };
}

/** Fraction of zones for which each system is complete (for the HUD bars). */
export function systemProgress(p: number): number[] {
  const { ramp } = MODEL.build;
  return MODEL.systems.map((s) => {
    let done = 0;
    for (const z of MODEL.zones) {
      if (clamp01((p - (z.arrival + s.lag)) / ramp) >= 0.999) done++;
    }
    return done / MODEL.zones.length;
  });
}
