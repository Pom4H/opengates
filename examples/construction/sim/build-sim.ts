// Close-to-reality construction simulation — the world that GENERATES the claims.
//
// drive.ts (the e2e) runs an idealized, fixed schedule. This shows the other half
// of the architecture (docs/architecture/realistic-simulation.md): a stochastic,
// RESOURCE-CONSTRAINED discrete-event simulation whose output is folded through
// the UNCHANGED acceptance engine.
//
//   - Materials arrive after a variable lead time (lognormal) — late deliveries
//     block the pour.
//   - Pours compete for ONE tower crane and a TWO-gang crew; the schedule emerges
//     from that contention, it is not tabulated.
//   - Some pours fail QC (seeded) → a real returned_for_rework → re-pour → accept
//     loop, with the crane re-contended.
//   - Each finished pour becomes an Acceptance Act (claim → survey → decision)
//     folded by examples/construction/systems/gate.json; deliveries/consumption
//     fold through examples/operations/flow.gate.json into a resource ledger.
//
// DETERMINISTIC: all randomness comes from a seeded Rng; all time is the sim
// clock. Same seed ⇒ identical run. An ensemble varies ONLY the seed → P50/P90.
//
//   node examples/construction/sim/build-sim.ts            # one run + ensemble
//   node examples/construction/sim/build-sim.ts --seed=7   # a specific world

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  fold,
  loadGate,
  normalizeLog,
  resourceLedger,
  type GateDefinition,
  type GateEvent,
  type GateState,
  type OperationalModel,
} from "../../../packages/engine/src/index.ts";
import { Rng, Sim, Resource, delay, seize, release, rng } from "../../../packages/sim/src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const model = readJson(join(ROOT, "viz/model/building.json"));
const sysGate: GateDefinition = loadGate(readJson(join(ROOT, "examples/construction/systems/gate.json")));
const flowGate: GateDefinition = loadGate(readJson(join(ROOT, "examples/operations/flow.gate.json")));
const opsModel: OperationalModel = readJson(join(ROOT, "viz/model/graph.json"));

// The dials that turn realism up or down. Set every variance to 0 and the run
// collapses to a clean deterministic baseline (the calibration anchor).
const PROFILE = {
  bays: 6,
  craneCapacity: 1, // the single tower crane — the bottleneck
  crewGangs: 2,
  dockSlots: 1,
  leadMedianDays: 7, // rebar delivery lead time
  leadSigma: 0.55,
  pourSigma: 0.3,
  defectRate: 0.18, // P(a pour fails QC → rework)
  reworkMinDays: 12,
  reworkMaxDays: 28,
  claimOptimism: 0.02, // contractor claims 2% high; survey is the reference
  disputeClaim: 0.12, // a disputed pour is claimed 12% high → fails cross_check
};

const DAY = 86_400_000;
const START = Date.parse("2026-03-02T08:00:00Z");
const date = (day: number) => new Date(START + Math.round(day * DAY)).toISOString().replace(/\.\d{3}Z$/, "Z");
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

interface Pour { zone: string; area: number; survey: number; rebarT: number; defect: boolean; t1: number; t2: number; }
interface RunResult {
  seed: number | string;
  finishDay: number;
  finishDate: string;
  acceptedNet: number;
  disputes: number;
  cranePeak: number;
  rebarIn: number;
  rebarOut: number;
  states: GateState[];
}

/** One world: a seeded, resource-constrained DES whose output folds through the engine. */
export function simulateOnce(seed: number | string): RunResult {
  const root = new Rng(seed);
  const supply = root.stream("supply");
  const work = root.stream("durations");
  const quality = root.stream("quality");

  const sim = new Sim();
  const crane = new Resource("crane", PROFILE.craneCapacity);
  const crew = new Resource("crew", PROFILE.crewGangs);
  const dock = new Resource("dock", PROFILE.dockSlots);

  const bays = (model.zones as any[])
    .filter((z) => z.scope === "bay" && /^[A-Z]\d+-F\d{2}$/.test(z.id))
    .sort((a, b) => a.arrival - b.arrival)
    .slice(0, PROFILE.bays);

  const pours: Pour[] = [];
  const deliveries: { zone: string; rebarT: number }[] = [];

  function* bayProcess(z: any): Generator<any, void, void> {
    const area = r1((z.structure.max[0] - z.structure.min[0]) * (z.structure.max[2] - z.structure.min[2]));
    const rebarT = r1(area * 0.03);

    // 1) Supply: order rebar; a variable lead time blocks everything downstream.
    yield seize(dock);
    yield delay(Math.max(2, Math.round(supply.lognormal(PROFILE.leadMedianDays, PROFILE.leadSigma))));
    deliveries.push({ zone: z.id, rebarT });
    yield release(dock);

    // 2) Pour: needs the crane AND a crew gang — contention shapes the schedule.
    yield seize(crane);
    yield seize(crew);
    const base = area * 0.05 + 1;
    yield delay(Math.max(1, Math.round(work.lognormal(base, PROFILE.pourSigma))));
    yield release(crew);
    yield release(crane);
    const t1 = sim.now;

    // 3) QC: a seeded fraction fail → rework re-contends for the crane.
    const defect = quality.bool(PROFILE.defectRate);
    if (defect) {
      yield delay(Math.round(quality.uniform(PROFILE.reworkMinDays, PROFILE.reworkMaxDays)));
      yield seize(crane);
      yield seize(crew);
      yield delay(Math.max(1, Math.round(base * 0.4)));
      yield release(crew);
      yield release(crane);
    }
    pours.push({ zone: z.id, area, survey: area, rebarT, defect, t1, t2: sim.now });
  }

  for (const z of bays) sim.process(bayProcess(z));
  sim.run();

  // --- fold the simulated world through the UNCHANGED engine ----------------
  const states: GateState[] = [];
  const flowStates: GateState[] = [];
  let disputes = 0;

  for (const p of pours) {
    const insp = { kind: "inspection", values: { quantity: p.survey, unit: "m2" }, ref: `inspect/${p.zone}-structure.pdf` };
    const claim = (q: number, at: string) => ({
      type: "claim.submitted", at, actor: "contractor:alfa-stroy",
      claim: { type: "system_work_completed", values: { system: "structure", work_item: "Monolithic frame", quantity: q, zone: p.zone } },
    });
    let raw: any[];
    if (p.defect) {
      disputes++;
      raw = [
        claim(r1(p.survey * (1 + PROFILE.disputeClaim)), date(p.t1)),
        { type: "evidence.attached", at: date(p.t1 + 1), actor: "surveyor:geo-point", evidence: insp },
        { type: "decision.recorded", at: date(p.t1 + 2), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor",
          outcome: "returned_for_rework", note: `Claim ${r1(p.survey * (1 + PROFILE.disputeClaim))} vs survey ${p.survey} m² — out of tolerance.` },
        claim(r1(p.survey * (1 + PROFILE.claimOptimism)), date(p.t2)),
        { type: "evidence.attached", at: date(p.t2 + 1), actor: "surveyor:geo-point", evidence: insp },
        { type: "decision.recorded", at: date(p.t2 + 2), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor",
          outcome: "accepted", acceptedValues: { quantity: p.survey }, note: `Reworked and accepted per survey ${p.survey} m².` },
      ];
    } else {
      raw = [
        claim(r1(p.survey * (1 + PROFILE.claimOptimism)), date(p.t1)),
        { type: "evidence.attached", at: date(p.t1 + 1), actor: "surveyor:geo-point", evidence: insp },
        { type: "decision.recorded", at: date(p.t1 + 2), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor",
          outcome: "accepted", acceptedValues: { quantity: p.survey }, note: `Accepted per survey ${p.survey} m².` },
      ];
    }
    states.push(fold(sysGate, normalizeLog(`${sysGate.id}#${p.zone}#structure`, raw) as GateEvent[]));
  }

  // Deliveries + consumption fold through the flow gate → a resource ledger.
  for (const d of deliveries) {
    const dRaw = [
      { type: "claim.submitted", at: date(0), actor: "carrier:steelhaul",
        claim: { type: "resource_flow", values: { flowKind: "deliver", resource: "MAT-rebar", qty: d.rebarT, unit: "t", from: "SUP-rebar", to: "MAT-rebar" } } },
      { type: "evidence.attached", at: date(1), actor: "weighbridge:gate-2", evidence: { kind: "reference_count", values: { qty: d.rebarT, unit: "t" } } },
      { type: "decision.recorded", at: date(1), actor: "storeman:petrov", reviewerRole: "goods_in", outcome: "accepted", acceptedValues: { qty: d.rebarT } },
    ];
    flowStates.push(fold(flowGate, normalizeLog(`deliver#${d.zone}`, dRaw) as GateEvent[]));
    const cRaw = [
      { type: "claim.submitted", at: date(2), actor: "foreman:sidorov",
        claim: { type: "resource_flow", values: { flowKind: "consume", resource: "MAT-rebar", qty: r1(d.rebarT * 0.85), unit: "t", from: "MAT-rebar", to: `SYS-${d.zone}-structure` } } },
    ];
    flowStates.push(fold(flowGate, normalizeLog(`consume#${d.zone}`, cRaw) as GateEvent[]));
  }

  const ACCEPTED = ["accepted", "accepted_with_exceptions"];
  let acceptedNet = 0;
  let finishMs = START;
  for (const s of states) {
    for (const e of s.consequences) if (e.effect === "money" && ACCEPTED.includes(s.status)) acceptedNet += (e.payload as any).net ?? 0;
    if (s.decidedAt) finishMs = Math.max(finishMs, Date.parse(s.decidedAt));
  }
  const ledger = resourceLedger(flowStates, opsModel).get("MAT-rebar");
  const finishDay = (finishMs - START) / DAY;

  return {
    seed, finishDay, finishDate: new Date(finishMs).toISOString().slice(0, 10),
    acceptedNet: r2(acceptedNet), disputes, cranePeak: crane.peak,
    rebarIn: r2(ledger?.in ?? 0), rebarOut: r2(ledger?.out ?? 0), states,
  };
}

/** Monte-Carlo ensemble: vary only the seed → a distribution of outcomes. */
export function ensemble(seeds: number[]): { finishP: number[]; netP: number[]; avgDisputes: number } {
  const runs = seeds.map((s) => simulateOnce(s));
  const pct = (xs: number[], p: number) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  };
  const finish = runs.map((r) => r.finishDay);
  const net = runs.map((r) => r.acceptedNet);
  return {
    finishP: [pct(finish, 0.1), pct(finish, 0.5), pct(finish, 0.9)].map((x) => Math.round(x)),
    netP: [pct(net, 0.5)],
    avgDisputes: r2(runs.reduce((s, r) => s + r.disputes, 0) / runs.length),
  };
}

// --- main (only when run directly) -----------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const seedArg = process.argv.find((a) => a.startsWith("--seed="));
  const seed = seedArg ? Number(seedArg.split("=")[1]) : 1;
  const one = simulateOnce(seed);
  console.log(`one world (seed ${seed}) — ${one.states.length} pours, ${one.disputes} disputed/reworked`);
  console.log(`  construction finished day ${Math.round(one.finishDay)} (${one.finishDate}); crane peak ${one.cranePeak}/${PROFILE.craneCapacity}`);
  console.log(`  earned value accepted: €${one.acceptedNet.toLocaleString("en-US")}; rebar ledger in ${one.rebarIn} t / out ${one.rebarOut} t`);

  const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
  const e = ensemble(seeds);
  console.log(`\nensemble of ${seeds.length} seeds (same plan, different worlds):`);
  console.log(`  finish day P10/P50/P90: ${e.finishP[0]} / ${e.finishP[1]} / ${e.finishP[2]} (calendar spread from supply + contention + rework)`);
  console.log(`  earned value P50: €${e.netP[0].toLocaleString("en-US")} (≈ constant — money is paid on the surveyed reality, not the slip)`);
  console.log(`  avg disputes/run: ${e.avgDisputes} of ${PROFILE.bays} pours`);

  const a = simulateOnce(42), b = simulateOnce(42);
  console.log(`\nreplayable: seed 42 twice ⇒ ${a.finishDate === b.finishDate && a.acceptedNet === b.acceptedNet ? "identical" : "DIVERGED"}`);
}
