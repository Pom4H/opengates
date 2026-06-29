// Open Gates — DES-driven, close-to-reality e2e construction simulator.
//
// drive.ts runs the SAME building on a fixed, idealized schedule (arrival ×
// daysPerBuildUnit, disputes on hash % N). This drives the WHOLE project from a
// resource-constrained discrete-event simulation (packages/sim): the per-bay
// systems sweep competes for finite crews per system, durations vary (lognormal),
// and a seeded fraction of pours fail QC → real returned_for_rework slips. The
// schedule EMERGES; only the dates change — every case still folds through the
// UNCHANGED gates and money is computed by consequences.ts exactly as before.
//
// It emits the SAME five files drive.ts does, into viz/model/e2e-sim/, so the
// control surface renders a *simulated* project (open it with ?src=sim), plus
// ensemble.json — P10/P50/P90 finish over many seeds (vary the seed → vary the
// world; fix it → byte-identical).
//
//   node examples/construction/e2e/simulate.ts            # primary run + ensemble
//   node examples/construction/e2e/simulate.ts --seed=7

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  fold,
  loadGate,
  normalizeLog,
  lintZones,
  zoneOf,
  type GateDefinition,
  type GateEvent,
  type GateState,
} from "../../../packages/engine/src/index.ts";
import { Rng, Sim, Resource, delay, seize, release } from "../../../packages/sim/src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const model = readJson(join(ROOT, "viz/model/building.json"));
const smeta = readJson(join(HERE, "smeta.json"));
const project = readJson(join(HERE, "project.json"));

const gate = (name: string): GateDefinition => loadGate(readJson(join(HERE, "gates", `${name}.json`)));
const GATES: Record<string, GateDefinition> = {
  design: gate("design-permit"),
  advance: gate("advance"),
  excavation: gate("excavation"),
  structure: gate("structure"),
  envelope: gate("envelope"),
  mep: gate("mep"),
  fitout: gate("fitout"),
  handover: gate("handover"),
  release: gate("final-release"),
  workVolume: loadGate(readJson(join(ROOT, "examples/construction/gate.json"))),
  hiddenWorks: loadGate(readJson(join(ROOT, "examples/construction/hidden-works/gate.json"))),
  fire: loadGate(readJson(join(ROOT, "examples/facilities/gate.json"))),
};

const rate = (key: string): number => smeta.lines.find((l: any) => l.key === key).rate_eur;

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const addDays = (isoStr: string, d: number) => iso(Date.parse(isoStr) + d * DAY);
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

// The dials. variance:0 (every σ/rate below ignored) reproduces a clean plan —
// the PV baseline; variance:1 is the lived world — the EV actual.
const PROFILE = {
  crews: { structure: 8, envelope: 6, mep: 6, fitout: 6 } as Record<string, number>,
  review: { structure: 4, envelope: 4, mep: 5, fitout: 5 } as Record<string, number>,
  durSigma: 0.3,
  raftLeadDays: 50, // bays cannot start until the raft is in
  defectRate: 0.06,
  reworkMin: 15,
  reworkMax: 30,
  claimOptimism: 0.02,
  disputeClaim: 0.12,
};
const SYS_ORDER = ["structure", "envelope", "mep", "fitout"] as const;

const bays = (model.zones as any[]).filter((z) => z.scope === "bay" && /^[A-Z]\d+-F\d{2}$/.test(z.id));
const facesOf = (z: any) => (z.bx === 0 ? 1 : 0) + (z.bx === model.grid.nx - 1 ? 1 : 0) + (z.bz === 0 ? 1 : 0) + (z.bz === model.grid.nz - 1 ? 1 : 0);
const bayArea = (z: any) => round1((z.structure.max[0] - z.structure.min[0]) * (z.structure.max[2] - z.structure.min[2]));
const qtyOf = (z: any, system: string): number => {
  const A = bayArea(z);
  if (system === "structure") return round1(A * 0.22 + 2.5);
  if (system === "envelope") return facesOf(z) > 0 && z.level !== "basement" ? round1(facesOf(z) * 15.5 + A * 0.3) : round1(A * 0.6);
  return A;
};
const baseDur = (z: any, system: string): number => {
  const q = qtyOf(z, system);
  if (system === "structure") return 3 + q * 0.25;
  if (system === "envelope") return 2 + q * 0.06;
  if (system === "mep") return 2 + q * 0.06;
  return 2 + q * 0.06;
};

// --- the scheduler: an emergent, resource-constrained per-bay sweep ----------
interface Slot { firstDay: number; finalDay: number; decideDay: number; dispute: boolean; }

function runSchedule(seed: number | string, variance: boolean): { sched: Map<string, Slot>; finishDay: number; disputes: number } {
  const root = new Rng(seed);
  const work = root.stream("durations");
  const quality = root.stream("quality");
  const sim = new Sim();
  const res: Record<string, Resource> = {};
  for (const s of SYS_ORDER) res[s] = new Resource(s, PROFILE.crews[s]);

  const sched = new Map<string, Slot>();
  let disputes = 0;

  function* bayProc(z: any): Generator<any, void, void> {
    yield delay(PROFILE.raftLeadDays); // wait for the raft
    for (const system of SYS_ORDER) {
      yield seize(res[system]);
      const base = baseDur(z, system);
      yield delay(variance ? Math.max(1, Math.round(work.lognormal(base, PROFILE.durSigma))) : Math.round(base));
      const firstDay = sim.now;
      let finalDay = firstDay;
      const dispute = variance && quality.bool(PROFILE.defectRate);
      if (dispute) {
        disputes++;
        yield delay(Math.round(quality.uniform(PROFILE.reworkMin, PROFILE.reworkMax)));
        yield delay(Math.max(1, Math.round(base * 0.4)));
        finalDay = sim.now;
      }
      yield release(res[system]);
      sched.set(`${z.id}|${system}`, { firstDay, finalDay, decideDay: finalDay + PROFILE.review[system], dispute });
    }
  }

  for (const z of [...bays].sort((a, b) => a.arrival - b.arrival)) sim.process(bayProc(z));
  sim.run();
  let finishDay = 0;
  for (const s of sched.values()) finishDay = Math.max(finishDay, s.decideDay);
  return { sched, finishDay, disputes };
}

// --- build + fold the whole project on a given schedule ---------------------
type Case = {
  id: string; gate: GateDefinition; phase: string; system?: string; zone?: string;
  plannedAt: string; plannedNet: number; events: GateEvent[]; state: GateState;
};

function buildProject(seed: number | string): { cases: Case[]; constructionValue: number; advanceBase: number; finishDay: number; disputes: number } {
  const actual = runSchedule(seed, true);
  const plan = runSchedule(seed, false); // variance-free → PV baseline dates
  const cases: Case[] = [];
  const build = (c: Omit<Case, "events" | "state"> & { raw: any[] }): Case => {
    const events = normalizeLog(c.id, c.raw as any) as GateEvent[];
    const state = fold(c.gate, events);
    const full = { ...c, events, state } as Case;
    delete (full as any).raw;
    cases.push(full);
    return full;
  };

  // The day-0 anchor: design/advance sit before it (negative offsets); the build
  // calendar is START + sim-day.
  const START = project.schedule.preConstruction.design_permit_at;
  const day = (d: number) => addDays(START, 90 + d); // 90d pre-construction lead before the sweep clock

  // contract value (for the 15% advance) — identical basis to drive.ts
  const footX = model.grid.nx * model.block.w;
  const footZ = model.grid.nz * model.block.d;
  const pitVol = Math.round((footX + 12) * (footZ + 12) * 9);
  const raftVol = round1(footX * footZ * 1.2);
  let constructionValue = pitVol * rate("excavation_earthworks") + raftVol * rate("foundation_concrete");
  for (const z of bays) {
    const A = bayArea(z);
    constructionValue += round1(A * 0.22 + 2.5) * rate("frame_concrete");
    const env = facesOf(z) > 0 && z.level !== "basement" ? round1(facesOf(z) * 15.5 + A * 0.3) : round1(A * 0.6);
    constructionValue += env * rate("envelope_facade");
    constructionValue += A * rate("mep_systems");
    constructionValue += A * rate("fit_out");
  }
  const advanceBase = Math.round(constructionValue * smeta.terms.advancePct);

  // 1) DESIGN + PERMIT
  build({
    id: GATES.design.id, gate: GATES.design, phase: "design", zone: "BLDG",
    plannedAt: project.schedule.preConstruction.design_permit_at, plannedNet: 480000,
    raw: [
      { type: "claim.submitted", at: addDays(project.schedule.preConstruction.design_permit_at, -8), actor: "contractor:alfa-stroy", claim: { type: "design_ready_for_construction", values: { project_stage: "Design + working documentation", permit_no: "77-RU-77123000-2026", zone: "BLDG", valid_from: "2026-01-12" } } },
      { type: "evidence.attached", at: addDays(project.schedule.preConstruction.design_permit_at, -6), actor: "contractor:alfa-stroy", evidence: { kind: "design_documentation", ref: "pd/PD-2025-corpus1.pdf" } },
      { type: "evidence.attached", at: addDays(project.schedule.preConstruction.design_permit_at, -4), actor: "authority:glavgosexpertiza", evidence: { kind: "expertise_conclusion", ref: "exp/77-1-1-3-2026.pdf" } },
      { type: "evidence.attached", at: addDays(project.schedule.preConstruction.design_permit_at, -2), actor: "authority:glavgosexpertiza", evidence: { kind: "construction_permit", ref: "permit/77-RU-77123000-2026.pdf" } },
      { type: "decision.recorded", at: project.schedule.preConstruction.design_permit_at, actor: "client:technical-customer", reviewerRole: "client_technical_customer", outcome: "accepted", note: "Design and permit accepted — construction authorized." },
    ],
  });

  // 2) ADVANCE
  build({
    id: GATES.advance.id, gate: GATES.advance, phase: "advance", zone: "BLDG",
    plannedAt: project.schedule.preConstruction.advance_at, plannedNet: advanceBase,
    raw: [
      { type: "claim.submitted", at: addDays(project.schedule.preConstruction.advance_at, -3), actor: "contractor:alfa-stroy", claim: { type: "advance_payment_request", values: { scope: "15% advance under the contract", zone: "BLDG", guarantee_valid_to: "2027-12-31" } } },
      { type: "evidence.attached", at: addDays(project.schedule.preConstruction.advance_at, -2), actor: "bank:guarantor", evidence: { kind: "advance_bank_guarantee", ref: "bg/BG-2026-0207.pdf" } },
      { type: "evidence.attached", at: addDays(project.schedule.preConstruction.advance_at, -1), actor: "contractor:alfa-stroy", evidence: { kind: "advance_invoice", ref: "inv/AV-2026-001.pdf" } },
      { type: "decision.recorded", at: project.schedule.preConstruction.advance_at, actor: "client:technical-customer", reviewerRole: "client_technical_customer", outcome: "accepted", acceptedValues: { advance_base: advanceBase }, note: `Advance 15% (${advanceBase.toLocaleString("ru-RU")} €) under bank guarantee.` },
    ],
  });

  // 3) EXCAVATION (early in the build calendar)
  build({
    id: GATES.excavation.id, gate: GATES.excavation, phase: "excavation", zone: "SITE",
    plannedAt: day(8), plannedNet: Math.round(pitVol * rate("excavation_earthworks") * 0.95 * 100) / 100,
    raw: [
      { type: "claim.submitted", at: day(0), actor: "contractor:alfa-stroy", claim: { type: "excavation_completed", values: { work_item: "Excavation pit dig to −9.0 m", quantity: pitVol + 40, design_elevation: -9.0, zone: "SITE" } } },
      { type: "evidence.attached", at: day(2), actor: "surveyor:geo-point", evidence: { kind: "geodetic_layout_act", ref: "geo/layout-axes.pdf" } },
      { type: "evidence.attached", at: day(3), actor: "surveyor:geo-point", evidence: { kind: "executive_survey", values: { quantity: pitVol, U: 60, unit: "m3" }, ref: "geo/pit-as-built.pdf" } },
      { type: "evidence.attached", at: day(4), actor: "lab:stroylab", evidence: { kind: "geotech_report", ref: "geo/soil-acceptance.pdf" } },
      { type: "decision.recorded", at: day(8), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor", outcome: "accepted", acceptedValues: { quantity: pitVol }, note: `Excavation pit accepted per survey ${pitVol} m³.` },
    ],
  });

  // 4) FOUNDATION — AOSR (hidden works) then raft volume
  build({
    id: GATES.hiddenWorks.id + "#raft", gate: GATES.hiddenWorks, phase: "foundation", zone: "BLDG-L00",
    plannedAt: day(22), plannedNet: 0,
    raw: [
      { type: "claim.submitted", at: day(20), actor: "contractor:alfa-stroy", claim: { type: "hidden_work_ready_for_cover", values: { work_item: "Foundation raft rebar A500C", axes: "axes 1–6 / A–G", ready_at: day(20), zone: "BLDG-L00" } } },
      { type: "evidence.attached", at: day(21), actor: "contractor:alfa-stroy", evidence: { kind: "executive_scheme", ref: "isp/raft-rebar-scheme.pdf" } },
      { type: "evidence.attached", at: day(21), actor: "contractor:alfa-stroy", evidence: { kind: "material_passport", ref: "pass/rebar-A500C.pdf" } },
      { type: "decision.recorded", at: day(22), actor: "control:stroycontrol", reviewerRole: "construction_control", outcome: "accepted", note: "AOSR: raft rebar inspected before concreting — concreting authorized." },
    ],
  });
  build({
    id: GATES.workVolume.id + "#raft", gate: GATES.workVolume, phase: "foundation", zone: "BLDG-L00",
    plannedAt: day(38), plannedNet: Math.round(raftVol * rate("foundation_concrete") * 0.95 * 100) / 100,
    raw: [
      { type: "claim.submitted", at: day(28), actor: "contractor:alfa-stroy", claim: { type: "work_volume_completed", values: { work_item: "Foundation raft concrete C25/30", quantity: round1(raftVol * 1.006), period: "2026-03", zone: "BLDG-L00" } } },
      { type: "evidence.attached", at: day(36), actor: "surveyor:geo-point", evidence: { kind: "executive_survey", values: { quantity: raftVol, U: 12, unit: "m3" }, ref: "geo/raft-as-built.pdf" } },
      { type: "evidence.attached", at: day(37), actor: "lab:stroylab", evidence: { kind: "concrete_strength_protocol", values: { grade: "C25/30", R28: 32.4 }, ref: "lab/raft-28d.pdf" } },
      { type: "evidence.attached", at: day(37), actor: "contractor:alfa-stroy", evidence: { kind: "works_log", ref: "log/raft.pdf" } },
      { type: "evidence.attached", at: day(37), actor: "contractor:alfa-stroy", evidence: { kind: "aosr_ref", ref: "aosr/raft-rebar.pdf" } },
      { type: "decision.recorded", at: day(38), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor", outcome: "accepted", acceptedValues: { quantity: raftVol }, note: `Raft accepted per survey ${raftVol} m³.` },
    ],
  });

  // 5) PER-BAY SYSTEMS — dates from the DES schedule
  const RATEKEY: Record<string, string> = { structure: "frame_concrete", envelope: "envelope_facade", mep: "mep_systems", fitout: "fit_out" };
  const WORKITEM: Record<string, (z: any) => string> = {
    structure: () => "Monolithic frame: columns + slab",
    envelope: (z) => (facesOf(z) > 0 && z.level !== "basement" ? "Curtain façade + glazing" : "Internal partitions"),
    mep: () => "Internal MEP (HVAC+plumbing+electrical)",
    fitout: () => "Fit-out / finishing works",
  };
  const EXTRA: Record<string, (z: any) => any[]> = {
    structure: (z) => [{ kind: "concrete_strength_protocol", values: { grade: "C30/37", R28: 41.2 }, ref: `lab/${z.id}-frame-28d.pdf` }],
    envelope: () => [],
    mep: (z) => [{ kind: "pressure_test_protocol", ref: `lab/${z.id}-mep-pressure.pdf`, values: { held_min: 30 } }, { kind: "lab_protocol", ref: `lab/${z.id}-mep-ei.pdf` }],
    fitout: () => [],
  };

  for (const z of [...bays].sort((a, b) => a.arrival - b.arrival)) {
    for (const system of SYS_ORDER) {
      const slot = actual.sched.get(`${z.id}|${system}`)!;
      const planSlot = plan.sched.get(`${z.id}|${system}`)!;
      const unit = system === "structure" ? "m3" : "m2";
      const survey = qtyOf(z, system);
      const U = round1(Math.max(unit === "m3" ? 1 : 2, survey * 0.04));
      const refKind = system === "mep" ? "inspection" : "executive_survey";
      const r = rate(RATEKEY[system]);
      const surveyEv = { kind: refKind, values: { quantity: survey, U, unit }, ref: `survey/${z.id}-${system}.pdf` };
      const insp = { kind: "inspection", values: { quantity: survey, unit }, ref: `inspect/${z.id}-${system}.pdf` };
      const claim = (q: number, at: string) => ({ type: "claim.submitted", at, actor: "contractor:alfa-stroy", claim: { type: "system_work_completed", values: { system, work_item: WORKITEM[system](z), quantity: q, zone: z.id } } });
      const evidence = (at: string) => [
        { type: "evidence.attached", at, actor: "surveyor:geo-point", evidence: surveyEv },
        { type: "evidence.attached", at, actor: "supervisor:ivanov", evidence: insp },
        ...EXTRA[system](z).map((e) => ({ type: "evidence.attached", at, actor: "lab:stroylab", evidence: e })),
      ];
      const claimHigh = round1(survey * (1 + PROFILE.claimOptimism));
      const f = day(slot.firstDay), fin = day(slot.finalDay), dec = day(slot.decideDay);
      let raw: any[];
      if (slot.dispute) {
        raw = [
          claim(round1(survey * (1 + PROFILE.disputeClaim)), f),
          ...evidence(addDays(f, 1)),
          { type: "decision.recorded", at: addDays(f, 2), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor", outcome: "returned_for_rework", note: `Survey ${survey} vs claim — out of tolerance (>5% / U). Returned for rework.` },
          claim(claimHigh, fin),
          ...evidence(addDays(fin, 1)),
          { type: "decision.recorded", at: dec, actor: "supervisor:ivanov", reviewerRole: "technical_supervisor", outcome: "accepted", acceptedValues: { quantity: survey }, note: `Reworked and accepted per survey ${survey} ${unit}.` },
        ];
      } else {
        raw = [
          claim(claimHigh, f),
          ...evidence(addDays(f, 1)),
          { type: "decision.recorded", at: dec, actor: "supervisor:ivanov", reviewerRole: "technical_supervisor", outcome: "accepted", acceptedValues: { quantity: survey }, note: `Accepted per survey ${survey} ${unit}.` },
        ];
      }
      build({
        id: `${SYSGATEID(system)}#${z.id}#${system}`, gate: GATES[system], phase: system, system, zone: z.id,
        plannedAt: day(planSlot.decideDay), plannedNet: Math.round(survey * r * 0.95 * 100) / 100, raw,
      });
    }
  }

  // 6) FIRE-SAFETY per floor (after that floor's fit-out)
  const levels = [...new Set(bays.map((z) => z.floor))].sort((a, b) => a - b);
  const lastFitoutAt = Math.max(...cases.filter((c) => c.system === "fitout" && c.state.decidedAt).map((c) => Date.parse(c.state.decidedAt!)));
  for (const fl of levels) {
    const z = bays.find((b) => b.floor === fl && b.col === "A" && b.row === 1) || bays.find((b) => b.floor === fl);
    const fit = cases.find((c) => c.zone === z.id && c.system === "fitout");
    const sub = fit?.state.decidedAt ? addDays(fit.state.decidedAt, 4) : iso(lastFitoutAt);
    build({
      id: GATES.fire.id + "#" + z.id, gate: GATES.fire, phase: "fire-safety", zone: z.id,
      plannedAt: addDays(sub, 2), plannedNet: 0,
      raw: [
        { type: "claim.submitted", at: sub, actor: "contractor:alfa-stroy", claim: { type: "fire_safety_inspection", values: { scope: "fire alarm / warning / smoke control, floor", zone: z.id } } },
        { type: "evidence.attached", at: addDays(sub, 1), actor: "lab:stroylab", evidence: { kind: "inspection_report", ref: `fire/${z.id}-aps-souet.pdf` } },
        { type: "decision.recorded", at: addDays(sub, 2), actor: "fire:officer-petrov", reviewerRole: "fire_safety_officer", outcome: "accepted", note: "Fire-safety systems of the floor accepted." },
      ],
    });
  }

  // 7) HANDOVER
  const allAcceptedAt = Math.max(...cases.filter((c) => c.state.decidedAt).map((c) => Date.parse(c.state.decidedAt!)));
  const handoverAt = addDays(iso(allAcceptedAt), project.schedule.handoverLagDays);
  build({
    id: GATES.handover.id, gate: GATES.handover, phase: "handover", zone: "BLDG", plannedAt: handoverAt, plannedNet: 0,
    raw: [
      { type: "claim.submitted", at: addDays(handoverAt, -10), actor: "contractor:alfa-stroy", claim: { type: "building_handover", values: { object_name: project.object.name, zone: "BLDG", commissioning_date: handoverAt.slice(0, 10) } } },
      { type: "evidence.attached", at: addDays(handoverAt, -7), actor: "authority:glavgosexpertiza", evidence: { kind: "zos", ref: "zos/ZOS-corpus1.pdf" } },
      { type: "evidence.attached", at: addDays(handoverAt, -5), actor: "authority:glavgosexpertiza", evidence: { kind: "commissioning_act", ref: "vvod/RV-77-2027.pdf" } },
      { type: "evidence.attached", at: addDays(handoverAt, -3), actor: "supervisor:ivanov", evidence: { kind: "defects_list", ref: "punch/final-list.pdf", values: { items: 6 } } },
      { type: "evidence.attached", at: addDays(handoverAt, -2), actor: "contractor:alfa-stroy", evidence: { kind: "as_built_dossier", ref: "isp/as-built-dossier.zip" } },
      { type: "decision.recorded", at: handoverAt, actor: "client:technical-customer", reviewerRole: "client_technical_customer", outcome: "accepted_with_exceptions", note: "Object commissioned with remediable remarks (6 items) — retention release initiated." },
    ],
  });

  // 8) RETENTION RELEASE
  const retentionOf = (c: Case): number => { let r = 0; for (const e of c.state.consequences) if (e.effect === "money") r += (e.payload as any).retention ?? 0; return r; };
  const reserve = Math.round(cases.reduce((s, c) => s + retentionOf(c), 0) * 100) / 100;
  const tranche1 = Math.round(reserve * 0.5 * 100) / 100;
  const tranche2 = Math.round((reserve - tranche1) * 100) / 100;
  const t1At = addDays(handoverAt, project.schedule.retentionTranche1LagDays);
  const t2At = addDays(handoverAt, project.schedule.defectsLiabilityDays);
  for (const [tr, amt, at, extra] of [
    ["Tranche 1 — 50% at commissioning", tranche1, t1At, [] as any[]],
    ["Tranche 2 — 50% after defects-liability period (730 days)", tranche2, t2At, [{ kind: "defects_liability_clearance", ref: "warranty/clearance.pdf" }]],
  ] as const) {
    build({
      id: GATES.release.id + "#" + (at === t1At ? "t1" : "t2"), gate: GATES.release, phase: "release", zone: "BLDG", plannedAt: at, plannedNet: amt,
      raw: [
        { type: "claim.submitted", at: addDays(at, -3), actor: "contractor:alfa-stroy", claim: { type: "retention_release_request", values: { tranche: tr, system: at === t1At ? "release-t1" : "release-t2", zone: "BLDG", release_date: at.slice(0, 10) } } },
        { type: "evidence.attached", at: addDays(at, -2), actor: "client:technical-customer", evidence: { kind: "handover_ref", ref: "vvod/RV-77-2027.pdf" } },
        ...extra.map((e) => ({ type: "evidence.attached", at: addDays(at, -2), actor: "client:technical-customer", evidence: e })),
        { type: "decision.recorded", at, actor: "client:technical-customer", reviewerRole: "client_technical_customer", outcome: "accepted", acceptedValues: { release_eur: amt }, note: `${tr}: retention release ${amt.toLocaleString("ru-RU")} €.` },
      ],
    });
  }

  return { cases, constructionValue, advanceBase, finishDay: actual.finishDay, disputes: actual.disputes };
}

const SYSGATEID = (system: string) => GATES[system].id;

// ---------------------------------------------------------------------------
// Emit the viewer files (ported from drive.ts; pure transform of `cases`)
// ---------------------------------------------------------------------------
const ACCEPTED = ["accepted", "accepted_with_exceptions"];
function docClass(kind: string): string {
  if (kind === "aosr_ref" || kind === "executive_scheme") return "aosr";
  if (kind === "executive_survey") return "obmer";
  if (kind.includes("protocol") || kind === "lab_protocol") return "protokol";
  if (kind === "zos" || kind === "commissioning_act" || kind === "construction_permit" || kind === "expertise_conclusion") return "permit";
  if (kind === "inspection" || kind === "inspection_report") return "inspection";
  if (kind === "defects_list") return "defects";
  if (kind === "photo_log") return "photo";
  return "doc";
}
const moneyEffect = (state: GateState): any | undefined => state.consequences.find((e) => e.effect === "money")?.payload as any;

function emit(seed: number | string, ens: any): void {
  const { cases, constructionValue, advanceBase } = buildProject(seed);
  const OUT = join(ROOT, "viz/model/e2e-sim");
  mkdirSync(OUT, { recursive: true });
  const states = cases.map((c) => c.state);

  // attachments.json
  const byZone: Record<string, any> = {};
  for (const c of cases) {
    const z = zoneOf(c.state); if (!z) continue;
    const entry = (byZone[z] ??= { zone: z, scope: (model.zones as any[]).find((m) => m.id === z)?.scope ?? "bay", works: [], documents: [], rollup: { total: 0, accepted: 0, pct: 0 } });
    const m = moneyEffect(c.state);
    const claimEv = c.events.find((e) => e.type === "claim.submitted") as any;
    const dec = c.state.decision;
    entry.works.push({
      gateId: c.state.gateId, system: c.system ?? null, phase: c.phase, title: c.system ?? (claimEv?.claim?.values?.work_item ?? claimEv?.claim?.type),
      status: c.state.status, outcome: dec?.outcome, claimedBy: claimEv?.actor, claimedAt: c.state.submittedAt, acceptedBy: dec?.by, role: dec?.role, acceptedAt: dec?.at,
      quantity: m?.quantity, unitPrice: m?.unitPrice, currency: m?.currency, gross: m?.gross, retention: m?.retention,
      net: m && ACCEPTED.includes(c.state.status) ? m.net : undefined, vat: m?.vat, estimateLine: m?.estimateLine,
      paymentDueAt: m?.paymentTermsDays && dec?.at ? addDays(dec.at, m.paymentTermsDays) : undefined, cycleDays: c.state.cycleDays,
    });
    for (const e of c.state.evidence) entry.documents.push({ kind: e.kind, docClass: docClass(e.kind), ref: e.ref, gateId: c.state.gateId });
  }
  for (const z of Object.values(byZone) as any[]) {
    z.rollup.total = z.works.length;
    z.rollup.accepted = z.works.filter((w: any) => ACCEPTED.includes(w.status)).length;
    z.rollup.pct = z.rollup.total ? z.rollup.accepted / z.rollup.total : 0;
    const seen = new Set<string>();
    z.documents = z.documents.filter((d: any) => { const k = d.kind + "|" + (d.ref || ""); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // timeline.json
  const tlEvents: any[] = [];
  for (const c of cases) for (const e of c.events as any[]) {
    const ev: any = { at: e.at, kind: e.type.split(".")[0], actor: e.actor, gate: c.state.gateId, zone: c.zone ?? null, phase: c.phase, system: c.system ?? null };
    if (e.type === "claim.submitted") ev.verb = "claimed";
    else if (e.type === "evidence.attached") { ev.verb = "attached"; ev.evidenceKind = e.evidence.kind; ev.docClass = docClass(e.evidence.kind); ev.ref = e.evidence.ref; }
    else if (e.type === "decision.recorded") {
      ev.verb = e.outcome; ev.outcome = e.outcome; ev.note = e.note;
      if (ACCEPTED.includes(e.outcome)) { const m = moneyEffect(c.state); if (m && (m.net ?? 0) !== 0) ev.money = { net: m.net, gross: m.gross, retention: m.retention, currency: m.currency, estimateLine: m.estimateLine }; }
    }
    tlEvents.push(ev);
  }
  tlEvents.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind > b.kind ? 1 : -1));
  tlEvents.forEach((e, i) => (e.seq = i));

  const STAGE_OF: Record<string, string> = { structure: "structure", envelope: "envelope", mep: "mep", fitout: "fitout" };
  const stageByZone: Record<string, any[]> = {};
  for (const c of cases) {
    if (!c.zone || !ACCEPTED.includes(c.state.status) || !c.state.decidedAt) continue;
    const list = (stageByZone[c.zone] ??= []);
    let stage = "accepted";
    if (c.system) stage = STAGE_OF[c.system];
    else if (c.zone === "SITE") stage = "kotlovan";
    else if (c.zone === "BLDG-L00") stage = "raft";
    else if (c.zone === "BLDG") stage = "handover";
    else if (c.phase === "fire-safety") stage = "fire-safety";
    list.push({ at: c.state.decidedAt, stage, system: c.system ?? null, phase: c.phase });
  }
  const sysOrder: Record<string, number> = { structure: 1, envelope: 2, mep: 3, fitout: 4 };
  for (const z of Object.keys(stageByZone)) {
    stageByZone[z].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let done = 0;
    for (const s of stageByZone[z]) { if (s.system) done = Math.max(done, sysOrder[s.system] ?? done); s.systemsDone = done; }
  }
  const roofAt = iso(Math.max(...cases.filter((c) => c.system === "structure" && c.state.decidedAt).map((c) => Date.parse(c.state.decidedAt!))));
  for (const rid of ["BLDG-R01", "BLDG-R02"]) stageByZone[rid] = [{ at: roofAt, stage: "roof", system: null, phase: "roof", systemsDone: 1 }];
  const range = { minAt: tlEvents[0].at, maxAt: tlEvents[tlEvents.length - 1].at };

  // ledger.json
  const period = (at: string) => at.slice(0, 7);
  const periodsMap = new Map<string, any>();
  for (const c of cases) {
    const m = moneyEffect(c.state);
    if (!m || !ACCEPTED.includes(c.state.status) || !c.state.decidedAt) continue;
    if (c.phase === "advance" || c.phase === "release" || c.phase === "design") continue;
    const p = period(c.state.decidedAt);
    const e = periodsMap.get(p) ?? { periodLabel: p, certifiedNet: 0, gross: 0, retentionThisPeriod: 0, vatMemo: 0, lines: 0, lastDue: c.state.decidedAt };
    e.certifiedNet += m.net; e.gross += m.gross; e.retentionThisPeriod += m.retention ?? 0; e.vatMemo += m.vat ?? 0; e.lines++;
    const due = addDays(c.state.decidedAt, m.paymentTermsDays ?? 30);
    if (Date.parse(due) > Date.parse(e.lastDue)) e.lastDue = due;
    periodsMap.set(p, e);
  }
  const advancePct = smeta.terms.advancePct;
  let advRemaining = advanceBase;
  const periods = [...periodsMap.values()].sort((a, b) => (a.periodLabel < b.periodLabel ? -1 : 1)).map((e) => {
    const recovery = Math.min(advRemaining, Math.round(e.gross * advancePct * 100) / 100);
    advRemaining = Math.round((advRemaining - recovery) * 100) / 100;
    return { periodLabel: e.periodLabel, ks3Id: "KS-3 " + e.periodLabel, lines: e.lines, gross: round2(e.gross), certifiedNet: round2(e.certifiedNet), retentionThisPeriod: round2(e.retentionThisPeriod), advanceRecovery: recovery, vatMemo: round2(e.vatMemo), netPayment: round2(e.certifiedNet - recovery), paymentDueAt: addDays(e.lastDue, 0) };
  });
  const retentionOf = (c: Case): number => { let r = 0; for (const e of c.state.consequences) if (e.effect === "money") r += (e.payload as any).retention ?? 0; return r; };
  const reserve = round2(cases.reduce((s, c) => s + retentionOf(c), 0));
  const tranche1 = round2(reserve * 0.5), tranche2 = round2(reserve - round2(reserve * 0.5));
  const hz = cases.find((c) => c.phase === "handover")!;
  const handoverAt = hz.state.decidedAt!;
  const t1At = addDays(handoverAt, project.schedule.retentionTranche1LagDays);
  const t2At = addDays(handoverAt, project.schedule.defectsLiabilityDays);
  const ledger = {
    currency: "EUR", contractValue: round2(constructionValue), designFee: 480000,
    advance: { issued: advanceBase, issuedAt: project.schedule.preConstruction.advance_at, recovered: round2(advanceBase - advRemaining), outstanding: round2(advRemaining) },
    retention: { held: reserve, released: round2(tranche1 + tranche2), reserve: round2(reserve - tranche1 - tranche2), tranche1, tranche2, tranche1At: t1At, tranche2At: t2At },
    periods, simulated: true,
  };

  // certificate.json (EVM)
  const moneyCases = cases.filter((c) => moneyEffect(c.state) && ACCEPTED.includes(c.state.status) && c.phase !== "advance" && c.phase !== "release" && c.phase !== "design");
  const evMin = Math.min(...moneyCases.map((c) => Math.min(Date.parse(c.state.decidedAt!), Date.parse(c.plannedAt))));
  const evMax = Math.max(...moneyCases.map((c) => Math.max(Date.parse(c.state.decidedAt!), Date.parse(c.plannedAt))));
  const sampleDates: string[] = [];
  for (let t = evMin; t < evMax; t += 14 * DAY) sampleDates.push(iso(t));
  sampleDates.push(iso(evMax));
  const cum = (dates: string[], pick: (c: Case) => { at: string; v: number }) => dates.map((at) => { let v = 0; for (const c of moneyCases) { const x = pick(c); if (Date.parse(x.at) <= Date.parse(at)) v += x.v; } return { at, cum: round2(v) }; });
  const bac = round2(moneyCases.reduce((s, c) => s + c.plannedNet, 0));
  const pv = cum(sampleDates, (c) => ({ at: c.plannedAt, v: c.plannedNet }));
  const ev = cum(sampleDates, (c) => ({ at: c.state.decidedAt!, v: moneyEffect(c.state)!.net ?? 0 }));
  const acwp = 1.07;
  const ac = cum(sampleDates, (c) => ({ at: c.state.decidedAt!, v: round2((moneyEffect(c.state)!.net ?? 0) * acwp) }));
  const spiCpiAt = sampleDates.map((at, i) => ({ at, spi: pv[i].cum ? round2(ev[i].cum / pv[i].cum) : 1, cpi: ac[i].cum ? round2(ev[i].cum / ac[i].cum) : 1 }));
  const ks3 = periods.map((p) => ({ ks3Id: p.ks3Id, period: p.periodLabel, lines: moneyCases.filter((c) => period(c.state.decidedAt!) === p.periodLabel).map((c) => { const m = moneyEffect(c.state)!; return { estimateLine: m.estimateLine, zone: c.zone, system: c.system ?? c.phase, quantity: m.quantity, unitPrice: m.unitPrice, gross: m.gross, retention: m.retention, net: m.net, vat: m.vat }; }), totals: { gross: p.gross, retention: p.retentionThisPeriod, net: p.certifiedNet, vat: p.vatMemo } }));
  const certificate = { currency: "EUR", asOfMax: range.maxAt, evm: { pv, ev, ac, bac }, spiCpiAt, ks3, simulated: true };

  const issues = lintZones(states, model);
  writeFileSync(join(OUT, "attachments.json"), JSON.stringify(byZone, null, 2) + "\n");
  writeFileSync(join(OUT, "timeline.json"), JSON.stringify({ range, events: tlEvents, stageByZone, simulated: true }, null, 2) + "\n");
  writeFileSync(join(OUT, "ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
  writeFileSync(join(OUT, "certificate.json"), JSON.stringify(certificate, null, 2) + "\n");
  writeFileSync(join(OUT, "roles.json"), JSON.stringify({ roles: project.roles, acts: project.acts, object: project.object, simulated: true }, null, 2) + "\n");
  writeFileSync(join(OUT, "ensemble.json"), JSON.stringify(ens, null, 2) + "\n");

  const accepted = cases.filter((c) => ACCEPTED.includes(c.state.status)).length;
  const disputed = cases.filter((c) => c.state.log.some((l) => l.includes("returned_for_rework"))).length;
  const totalNet = round2(moneyCases.reduce((s, c) => s + (moneyEffect(c.state)!.net ?? 0), 0));
  console.log(`SIM e2e (seed ${seed}) — ${cases.length} cases (${accepted} accepted), ${disputed} reworked.`);
  console.log(`Span ${range.minAt.slice(0, 10)} → ${range.maxAt.slice(0, 10)}; earned value €${totalNet.toLocaleString("en-US")}; lint: ${issues.length ? issues.map((i) => i.kind).join(",") : "ok"}.`);
  console.log(`Wrote viz/model/e2e-sim/{attachments,timeline,ledger,certificate,roles,ensemble}.json`);
}

// --- ensemble (cheap: schedule only, no folding) ---------------------------
export function ensembleStats(seeds: number[]): any {
  const finishes = seeds.map((s) => runSchedule(s, true).finishDay);
  const disputes = seeds.map((s) => runSchedule(s, true).disputes);
  const planned = runSchedule(seeds[0], false).finishDay;
  const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  return {
    runs: seeds.length, plannedFinishDay: planned,
    finishDayP10: pct(finishes, 0.1), finishDayP50: pct(finishes, 0.5), finishDayP90: pct(finishes, 0.9),
    avgDisputes: round2(disputes.reduce((a, b) => a + b, 0) / disputes.length),
  };
}

export { buildProject, runSchedule };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const seedArg = process.argv.find((a) => a.startsWith("--seed="));
  const seed = seedArg ? Number(seedArg.split("=")[1]) : 1;
  const ens = ensembleStats(Array.from({ length: 24 }, (_, i) => i + 1));
  emit(seed, ens);
  console.log(`Ensemble (${ens.runs} seeds): finish day P10/P50/P90 = ${ens.finishDayP10}/${ens.finishDayP50}/${ens.finishDayP90} (planned ${ens.plannedFinishDay}); avg disputes ${ens.avgDisputes}.`);
}
