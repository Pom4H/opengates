// Open Gates — end-to-end construction project simulator.
//
// Drives a WHOLE building through the real, unchanged fold engine: design and
// permit → advance → котлован → фундаментная плита (АОСР + raft) → 384 bays ×
// 4 parallel systems (structure → envelope → MEP → fit-out) → fire-safety →
// handover (ЗОС + акт ввода) → retention release in two tranches. Every case is
// a real Acceptance Act (claim → evidence → decision); money is paid on the
// ACCEPTED (surveyed) quantity exactly as consequences.ts computes it.
//
// It is DETERMINISTIC: no Date.now(), no Math.random(). All calendar dates come
// from each zone's build-order arrival (viz/model/building.json) + a fixed
// schedule; all "friction" (rare disputes / punch-lists / cost overrun) is
// seeded off a hash of the case id. Same inputs ⇒ identical outputs, forever.
//
// Emits, into viz/model/e2e/, the four files the control-surface viewer reads:
//   attachments.json  — per-zone works + documents (extended ZoneAttachments)
//   timeline.json     — every engine event + per-zone accepted-stage history
//   ledger.json       — КС-3 periods, retention reserve, advance recovery
//   certificate.json  — EVM (PV/EV/AC, SPI/CPI) + КС-3 line detail
//
//   node examples/construction/e2e/drive.ts

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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// --- inputs ----------------------------------------------------------------
const model = readJson(join(ROOT, "viz/model/building.json"));
const smeta = readJson(join(HERE, "smeta.json"));
const project = readJson(join(HERE, "project.json"));

const gate = (name: string): GateDefinition =>
  loadGate(readJson(join(HERE, "gates", `${name}.json`)));
const workVolumeGate = loadGate(readJson(join(ROOT, "examples/construction/gate.json")));
const hiddenWorksGate = loadGate(readJson(join(ROOT, "examples/construction/hidden-works/gate.json")));
const fireGate = loadGate(readJson(join(ROOT, "examples/facilities/gate.json")));
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
  workVolume: workVolumeGate,
  hiddenWorks: hiddenWorksGate,
  fire: fireGate,
};

const rate = (key: string): number => smeta.lines.find((l: any) => l.key === key).rate_eur;
const estLine = (key: string): string => smeta.lines.find((l: any) => l.key === key).estimateLine;

// --- deterministic helpers -------------------------------------------------
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const addDays = (isoStr: string, d: number) => iso(Date.parse(isoStr) + d * DAY);
const round1 = (x: number) => Math.round(x * 10) / 10;

// FNV-1a hash → a stable per-case integer, so "friction" is reproducible.
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const T0 = project.schedule.t0_at_min_arrival;
const DPU = project.schedule.daysPerBuildUnit;
const MIN_A = model.build.minArrival;
const arrivalToDate = (a: number) => addDays(T0, (a - MIN_A) * DPU);

const SYS = model.systems as { id: string; name: string; lag: number }[];
const lagOf = (id: string) => SYS.find((s) => s.id === id)!.lag;
const fr = project.friction;

// --- case construction -----------------------------------------------------
type Case = {
  id: string;
  gate: GateDefinition;
  phase: string;
  system?: string;
  zone?: string;
  plannedAt: string; // nominal decision date (ignores dispute slip) — for PV
  plannedNet: number; // nominal net certified — for PV
  events: GateEvent[];
  state: GateState;
};

const cases: Case[] = [];
function build(c: Omit<Case, "events" | "state"> & { raw: any[] }): Case {
  const events = normalizeLog(c.id, c.raw as any) as GateEvent[];
  const state = fold(c.gate, events);
  const full = { ...c, events, state } as Case;
  delete (full as any).raw;
  cases.push(full);
  return full;
}

// A normal acceptance: contractor claims slightly high, surveyor reads the
// reference, technadzor accepts on the surveyed value. Rare seeded disputes
// (claim far above survey → returned_for_rework → corrected → accepted, with a
// schedule slip) and punch-lists (accepted_with_exceptions) add realism.
type SysSpec = {
  id: string;
  phase: string;
  system: string;
  gate: GateDefinition;
  zone: string;
  workItem: string;
  unit: string;
  surveyQty: number;
  rateKey: string;
  ea: number; // effective arrival (zone arrival + system lag)
  refKind: string; // evidence kind carrying the surveyed reference
  extraEvidence: { kind: string; ref: string; values?: any }[];
};

function systemCase(s: SysSpec): Case {
  const h = seed(s.zone + ":" + s.system);
  const dispute = h % fr.disputeEveryN === 0;
  const remarks = !dispute && h % fr.remarksEveryN === 0;
  const r = rate(s.rateKey);
  const survey = s.surveyQty;
  const U = round1(Math.max(s.unit === "m3" ? 1 : 2, survey * 0.04));
  const sub = arrivalToDate(s.ea);
  const claimHigh = round1(survey * (1 + fr.claimOptimismPct));
  const surveyEv = { kind: s.refKind, values: { quantity: survey, U, unit: s.unit }, ref: `survey/${s.zone}-${s.system}.pdf` };
  const insp = { kind: "inspection", values: { quantity: survey, unit: s.unit }, ref: `inspect/${s.zone}-${s.system}.pdf` };

  const claim = (q: number, at: string) => ({
    type: "claim.submitted", at, actor: "contractor:alfa-stroy",
    claim: { type: "system_work_completed", values: { system: s.system, work_item: s.workItem, quantity: q, zone: s.zone } },
  });
  const evidence = (at: string) => [
    { type: "evidence.attached", at, actor: "supervisor:ivanov", evidence: insp },
    { type: "evidence.attached", at, actor: "surveyor:geo-point", evidence: surveyEv },
    ...s.extraEvidence.map((e) => ({ type: "evidence.attached", at, actor: "lab:stroylab", evidence: e })),
  ];

  let raw: any[];
  let plannedAt = addDays(sub, 4);
  if (dispute) {
    const over = round1(survey * 1.12);
    raw = [
      claim(over, sub),
      ...evidence(addDays(sub, 2)),
      { type: "decision.recorded", at: addDays(sub, 6), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor",
        outcome: "returned_for_rework", note: `Обмер ${survey} против заявленных ${over} ${s.unit} — расхождение вне допуска (>5% / U). Возврат на доработку.` },
      claim(claimHigh, addDays(sub, 25)),
      ...evidence(addDays(sub, 27)),
      { type: "decision.recorded", at: addDays(sub, 35), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor",
        outcome: "accepted", acceptedValues: { quantity: survey }, note: `Скорректировано и принято по обмеру ${survey} ${s.unit} (доработка ~1 мес.).` },
    ];
  } else {
    const punch = remarks
      ? [{ type: "evidence.attached", at: addDays(sub, 2), actor: "supervisor:ivanov", evidence: { kind: "defects_list", ref: `punch/${s.zone}-${s.system}.pdf`, values: { items: 3 } } }]
      : [];
    raw = [
      claim(claimHigh, sub),
      ...evidence(addDays(sub, 2)),
      ...punch,
      { type: "decision.recorded", at: addDays(sub, remarks ? 5 : 4), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor",
        outcome: remarks ? "accepted_with_exceptions" : "accepted", acceptedValues: { quantity: survey },
        note: remarks ? `Принято с замечаниями (ведомость на 3 позиции), к устранению.` : `Принято по обмеру ${survey} ${s.unit}.` },
    ];
  }
  return build({ id: `${s.gate.id}#${s.zone}#${s.system}`, gate: s.gate, phase: s.phase, system: s.system, zone: s.zone,
    plannedAt, plannedNet: Math.round(survey * r * 0.95 * 100) / 100, raw });
}

// --- enumerate the project -------------------------------------------------
const bays = (model.zones as any[]).filter((z) => z.scope === "bay");
const GAP2 = 2 * 0.16;
const facesOf = (z: any) => (z.bx === 0 ? 1 : 0) + (z.bx === model.grid.nx - 1 ? 1 : 0) + (z.bz === 0 ? 1 : 0) + (z.bz === model.grid.nz - 1 ? 1 : 0);
const bayArea = (z: any) => round1((z.structure.max[0] - z.structure.min[0]) * (z.structure.max[2] - z.structure.min[2]));

// Construction contract value (for the 15% advance): planned gross of every
// unit-rate construction line (excavation + raft + all bay systems).
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

// 1) DESIGN + PERMIT (BLDG)
build({
  id: GATES.design.id, gate: GATES.design, phase: "design", zone: "BLDG",
  plannedAt: project.schedule.preConstruction.design_permit_at, plannedNet: 480000,
  raw: [
    { type: "claim.submitted", at: addDays(project.schedule.preConstruction.design_permit_at, -8), actor: "contractor:alfa-stroy",
      claim: { type: "design_ready_for_construction", values: { project_stage: "П + Рабочая документация", permit_no: "77-RU-77123000-2026", zone: "BLDG", valid_from: "2026-01-12" } } },
    { type: "evidence.attached", at: addDays(project.schedule.preConstruction.design_permit_at, -6), actor: "contractor:alfa-stroy", evidence: { kind: "design_documentation", ref: "pd/PD-2025-corpus1.pdf" } },
    { type: "evidence.attached", at: addDays(project.schedule.preConstruction.design_permit_at, -4), actor: "authority:glavgosexpertiza", evidence: { kind: "expertise_conclusion", ref: "exp/77-1-1-3-2026.pdf" } },
    { type: "evidence.attached", at: addDays(project.schedule.preConstruction.design_permit_at, -2), actor: "authority:glavgosexpertiza", evidence: { kind: "construction_permit", ref: "permit/77-RU-77123000-2026.pdf" } },
    { type: "decision.recorded", at: project.schedule.preConstruction.design_permit_at, actor: "client:technical-customer", reviewerRole: "client_technical_customer", outcome: "accepted", note: "Проектная документация и разрешение приняты — СМР разрешены." },
  ],
});

// 2) ADVANCE (BLDG, fixed 15% via acceptedValues)
build({
  id: GATES.advance.id, gate: GATES.advance, phase: "advance", zone: "BLDG",
  plannedAt: project.schedule.preConstruction.advance_at, plannedNet: advanceBase,
  raw: [
    { type: "claim.submitted", at: addDays(project.schedule.preConstruction.advance_at, -3), actor: "contractor:alfa-stroy",
      claim: { type: "advance_payment_request", values: { scope: "Авансирование 15% по договору", zone: "BLDG", guarantee_valid_to: "2027-12-31" } } },
    { type: "evidence.attached", at: addDays(project.schedule.preConstruction.advance_at, -2), actor: "bank:guarantor", evidence: { kind: "advance_bank_guarantee", ref: "bg/BG-2026-0207.pdf" } },
    { type: "evidence.attached", at: addDays(project.schedule.preConstruction.advance_at, -1), actor: "contractor:alfa-stroy", evidence: { kind: "advance_invoice", ref: "inv/AV-2026-001.pdf" } },
    { type: "decision.recorded", at: project.schedule.preConstruction.advance_at, actor: "client:technical-customer", reviewerRole: "client_technical_customer", outcome: "accepted", acceptedValues: { advance_base: advanceBase }, note: `Аванс 15% (${advanceBase.toLocaleString("ru-RU")} €) под банковскую гарантию.` },
  ],
});

// 3) EXCAVATION (SITE)
{
  const siteA = (model.zones as any[]).find((z) => z.id === "SITE").arrival;
  const sub = arrivalToDate(siteA);
  build({
    id: GATES.excavation.id, gate: GATES.excavation, phase: "excavation", zone: "SITE",
    plannedAt: addDays(sub, 6), plannedNet: Math.round(pitVol * rate("excavation_earthworks") * 0.95 * 100) / 100,
    raw: [
      { type: "claim.submitted", at: sub, actor: "contractor:alfa-stroy", claim: { type: "excavation_completed", values: { work_item: "Разработка котлована до −9.0 м", quantity: pitVol + 40, design_elevation: -9.0, zone: "SITE" } } },
      { type: "evidence.attached", at: addDays(sub, 2), actor: "surveyor:geo-point", evidence: { kind: "geodetic_layout_act", ref: "geo/layout-axes.pdf" } },
      { type: "evidence.attached", at: addDays(sub, 3), actor: "surveyor:geo-point", evidence: { kind: "executive_survey", values: { quantity: pitVol, U: 60, unit: "m3" }, ref: "geo/pit-as-built.pdf" } },
      { type: "evidence.attached", at: addDays(sub, 4), actor: "lab:stroylab", evidence: { kind: "geotech_report", ref: "geo/soil-acceptance.pdf" } },
      { type: "decision.recorded", at: addDays(sub, 6), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor", outcome: "accepted", acceptedValues: { quantity: pitVol }, note: `Котлован принят по съёмке ${pitVol} м³, отметка дна −9.0 м.` },
    ],
  });
}

// 4) FOUNDATION — hidden works (АОСР, BLDG-L00) then raft volume (work-volume gate)
{
  const fndA = (model.zones as any[]).find((z) => z.id === "BLDG-L00").arrival;
  const sub = arrivalToDate(fndA);
  build({
    id: GATES.hiddenWorks.id + "#raft", gate: GATES.hiddenWorks, phase: "foundation", zone: "BLDG-L00",
    plannedAt: addDays(sub, 2), plannedNet: 0,
    raw: [
      { type: "claim.submitted", at: sub, actor: "contractor:alfa-stroy", claim: { type: "hidden_work_ready_for_cover", values: { work_item: "Армирование фундаментной плиты A500С", axes: "оси 1–6 / А–Г", ready_at: addDays(sub, 0), zone: "BLDG-L00" } } },
      { type: "evidence.attached", at: addDays(sub, 1), actor: "contractor:alfa-stroy", evidence: { kind: "executive_scheme", ref: "isp/raft-rebar-scheme.pdf" } },
      { type: "evidence.attached", at: addDays(sub, 1), actor: "contractor:alfa-stroy", evidence: { kind: "material_passport", ref: "pass/rebar-A500C.pdf" } },
      { type: "decision.recorded", at: addDays(sub, 2), actor: "control:stroycontrol", reviewerRole: "construction_control", outcome: "accepted", note: "АОСР: армирование плиты освидетельствовано до бетонирования — разрешено бетонирование." },
    ],
  });
  const rsub = addDays(sub, 6);
  build({
    id: GATES.workVolume.id + "#raft", gate: GATES.workVolume, phase: "foundation", zone: "BLDG-L00",
    plannedAt: addDays(rsub, 10), plannedNet: Math.round(raftVol * rate("foundation_concrete") * 0.95 * 100) / 100,
    raw: [
      { type: "claim.submitted", at: rsub, actor: "contractor:alfa-stroy", claim: { type: "work_volume_completed", values: { work_item: "Бетон фундаментной плиты C25/30", quantity: round1(raftVol * 1.006), period: "2026-03", zone: "BLDG-L00" } } },
      { type: "evidence.attached", at: addDays(rsub, 8), actor: "surveyor:geo-point", evidence: { kind: "executive_survey", values: { quantity: raftVol, U: 12, unit: "m3" }, ref: "geo/raft-as-built.pdf" } },
      { type: "evidence.attached", at: addDays(rsub, 9), actor: "lab:stroylab", evidence: { kind: "concrete_strength_protocol", values: { grade: "C25/30", R28: 32.4 }, ref: "lab/raft-28d.pdf" } },
      { type: "evidence.attached", at: addDays(rsub, 9), actor: "contractor:alfa-stroy", evidence: { kind: "works_log", ref: "log/raft.pdf" } },
      { type: "evidence.attached", at: addDays(rsub, 9), actor: "contractor:alfa-stroy", evidence: { kind: "aosr_ref", ref: "aosr/raft-rebar.pdf" } },
      { type: "decision.recorded", at: addDays(rsub, 10), actor: "supervisor:ivanov", reviewerRole: "technical_supervisor", outcome: "accepted", acceptedValues: { quantity: raftVol }, note: `Плита принята по обмеру ${raftVol} м³ (C25/30, R28 32.4 МПа).` },
    ],
  });
}

// 5) PER-BAY SYSTEMS SWEEP
const SYSGATE: Record<string, GateDefinition> = { structure: GATES.structure, envelope: GATES.envelope, mep: GATES.mep, fitout: GATES.fitout };
const RATEKEY: Record<string, string> = { structure: "frame_concrete", envelope: "envelope_facade", mep: "mep_systems", fitout: "fit_out" };
const WORKITEM: Record<string, (z: any) => string> = {
  structure: () => "Монолитный каркас: колонны + перекрытие",
  envelope: (z) => (facesOf(z) > 0 && z.level !== "basement" ? "Навесной фасад + остекление" : "Внутренние ограждающие конструкции / перегородки"),
  mep: () => "Внутренние инженерные системы (ОВ+ВК+ЭОМ)",
  fitout: () => "Отделочные работы / чистовая отделка",
};
const EXTRA: Record<string, (z: any) => any[]> = {
  structure: (z) => [{ kind: "concrete_strength_protocol", values: { grade: "C30/37", R28: 41.2 }, ref: `lab/${z.id}-frame-28d.pdf` }],
  envelope: () => [],
  mep: (z) => [
    { kind: "pressure_test_protocol", ref: `lab/${z.id}-mep-pressure.pdf`, values: { held_min: 30 } },
    { kind: "lab_protocol", ref: `lab/${z.id}-mep-ei.pdf` },
  ],
  fitout: () => [],
};

for (const z of [...bays].sort((a, b) => a.arrival - b.arrival)) {
  const A = bayArea(z);
  for (const system of ["structure", "envelope", "mep", "fitout"]) {
    const unit = system === "structure" ? "m3" : "m2";
    let q: number;
    if (system === "structure") q = round1(A * 0.22 + 2.5);
    else if (system === "envelope") q = facesOf(z) > 0 && z.level !== "basement" ? round1(facesOf(z) * 15.5 + A * 0.3) : round1(A * 0.6);
    else q = A;
    const refKind = system === "mep" ? "inspection" : "executive_survey";
    systemCase({
      id: "", gate: SYSGATE[system], phase: system, system, zone: z.id,
      workItem: WORKITEM[system](z), unit, surveyQty: q, rateKey: RATEKEY[system],
      ea: z.arrival + lagOf(system), refKind, extraEvidence: EXTRA[system](z),
    } as any);
  }
}

// 6) FIRE-SAFETY per floor (one representative bay per level)
const levels = [...new Set(bays.map((z) => z.floor))].sort((a, b) => a - b);
const lastFitoutAt = Math.max(...cases.filter((c) => c.system === "fitout" && c.state.decidedAt).map((c) => Date.parse(c.state.decidedAt!)));
for (const f of levels) {
  const z = bays.find((b) => b.floor === f && b.col === "A" && b.row === 1) || bays.find((b) => b.floor === f);
  const fit = cases.find((c) => c.zone === z.id && c.system === "fitout");
  const sub = fit?.state.decidedAt ? addDays(fit.state.decidedAt, 4) : iso(lastFitoutAt);
  build({
    id: GATES.fire.id + "#" + z.id, gate: GATES.fire, phase: "fire-safety", zone: z.id,
    plannedAt: addDays(sub, 2), plannedNet: 0,
    raw: [
      { type: "claim.submitted", at: sub, actor: "contractor:alfa-stroy", claim: { type: "fire_safety_inspection", values: { scope: "АПС / СОУЭ / дымоудаление, этаж", zone: z.id } } },
      { type: "evidence.attached", at: addDays(sub, 1), actor: "lab:stroylab", evidence: { kind: "inspection_report", ref: `fire/${z.id}-aps-souet.pdf` } },
      { type: "decision.recorded", at: addDays(sub, 2), actor: "fire:officer-petrov", reviewerRole: "fire_safety_officer", outcome: "accepted", note: "Противопожарные системы этажа приняты — право на эксплуатацию открыто." },
    ],
  });
}

// 7) HANDOVER (BLDG)
const allAcceptedAt = Math.max(...cases.filter((c) => c.state.decidedAt).map((c) => Date.parse(c.state.decidedAt!)));
const handoverAt = addDays(iso(allAcceptedAt), project.schedule.handoverLagDays);
build({
  id: GATES.handover.id, gate: GATES.handover, phase: "handover", zone: "BLDG",
  plannedAt: handoverAt, plannedNet: 0,
  raw: [
    { type: "claim.submitted", at: addDays(handoverAt, -10), actor: "contractor:alfa-stroy", claim: { type: "building_handover", values: { object_name: project.object.name, zone: "BLDG", commissioning_date: handoverAt.slice(0, 10) } } },
    { type: "evidence.attached", at: addDays(handoverAt, -7), actor: "authority:glavgosexpertiza", evidence: { kind: "zos", ref: "zos/ZOS-corpus1.pdf" } },
    { type: "evidence.attached", at: addDays(handoverAt, -5), actor: "authority:glavgosexpertiza", evidence: { kind: "commissioning_act", ref: "vvod/RV-77-2027.pdf" } },
    { type: "evidence.attached", at: addDays(handoverAt, -3), actor: "supervisor:ivanov", evidence: { kind: "defects_list", ref: "punch/final-list.pdf", values: { items: 6 } } },
    { type: "evidence.attached", at: addDays(handoverAt, -2), actor: "contractor:alfa-stroy", evidence: { kind: "as_built_dossier", ref: "isp/as-built-dossier.zip" } },
    { type: "decision.recorded", at: handoverAt, actor: "client:technical-customer", reviewerRole: "client_technical_customer", outcome: "accepted_with_exceptions", note: "Объект принят в эксплуатацию с устранимыми замечаниями (6 позиций) — возврат удержания запущен." },
  ],
});

// 8) RETENTION RELEASE — reserve = Σ retention across all positive money effects
function retentionOf(c: Case): number {
  let r = 0;
  for (const e of c.state.consequences) if (e.effect === "money") r += (e.payload as any).retention ?? 0;
  return r;
}
const reserve = Math.round(cases.reduce((s, c) => s + retentionOf(c), 0) * 100) / 100;
const tranche1 = Math.round(reserve * 0.5 * 100) / 100;
const tranche2 = Math.round((reserve - tranche1) * 100) / 100;
const t1At = addDays(handoverAt, project.schedule.retentionTranche1LagDays);
const t2At = addDays(handoverAt, project.schedule.defectsLiabilityDays);
for (const [tr, amt, at, extra] of [
  ["Транш 1 — 50% при вводе", tranche1, t1At, [] as any[]],
  ["Транш 2 — 50% после гарантийного периода (730 дн.)", tranche2, t2At, [{ kind: "defects_liability_clearance", ref: "warranty/clearance.pdf" }]],
] as const) {
  build({
    id: GATES.release.id + "#" + (at === t1At ? "t1" : "t2"), gate: GATES.release, phase: "release", zone: "BLDG",
    plannedAt: at, plannedNet: amt,
    raw: [
      { type: "claim.submitted", at: addDays(at, -3), actor: "contractor:alfa-stroy", claim: { type: "retention_release_request", values: { tranche: tr, system: at === t1At ? "release-t1" : "release-t2", zone: "BLDG", release_date: at.slice(0, 10) } } },
      { type: "evidence.attached", at: addDays(at, -2), actor: "client:technical-customer", evidence: { kind: "handover_ref", ref: "vvod/RV-77-2027.pdf" } },
      ...extra.map((e) => ({ type: "evidence.attached", at: addDays(at, -2), actor: "client:technical-customer", evidence: e })),
      { type: "decision.recorded", at, actor: "client:technical-customer", reviewerRole: "client_technical_customer", outcome: "accepted", acceptedValues: { release_eur: amt }, note: `${tr}: возврат удержания ${amt.toLocaleString("ru-RU")} €.` },
    ],
  });
}

// ---------------------------------------------------------------------------
// Emit the viewer data files
// ---------------------------------------------------------------------------
const OUT = join(ROOT, "viz/model/e2e");
mkdirSync(OUT, { recursive: true });
const states = cases.map((c) => c.state);

// classify a document for the viewer
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
function moneyEffect(state: GateState): any | undefined {
  return state.consequences.find((e) => e.effect === "money")?.payload as any;
}

// --- attachments.json (extended ZoneAttachments) ---------------------------
const ACCEPTED = ["accepted", "accepted_with_exceptions"];
const byZone: Record<string, any> = {};
for (const c of cases) {
  const z = zoneOf(c.state);
  if (!z) continue;
  const entry = (byZone[z] ??= { zone: z, scope: (model.zones as any[]).find((m) => m.id === z)?.scope ?? "bay", works: [], documents: [], rollup: { total: 0, accepted: 0, pct: 0 } });
  const m = moneyEffect(c.state);
  const claimEv = c.events.find((e) => e.type === "claim.submitted") as any;
  const dec = c.state.decision;
  entry.works.push({
    gateId: c.state.gateId, system: c.system ?? null, phase: c.phase, title: c.system ?? (claimEv?.claim?.values?.work_item ?? claimEv?.claim?.type),
    status: c.state.status, outcome: dec?.outcome,
    claimedBy: claimEv?.actor, claimedAt: c.state.submittedAt, acceptedBy: dec?.by, role: dec?.role, acceptedAt: dec?.at,
    quantity: m?.quantity, unitPrice: m?.unitPrice, currency: m?.currency, gross: m?.gross, retention: m?.retention,
    net: m && ACCEPTED.includes(c.state.status) ? m.net : undefined, vat: m?.vat, estimateLine: m?.estimateLine,
    paymentDueAt: m?.paymentTermsDays && dec?.at ? addDays(dec.at, m.paymentTermsDays) : undefined,
    cycleDays: c.state.cycleDays,
  });
  for (const e of c.state.evidence) entry.documents.push({ kind: e.kind, docClass: docClass(e.kind), ref: e.ref, gateId: c.state.gateId });
}
for (const z of Object.values(byZone) as any[]) {
  z.rollup.total = z.works.length;
  z.rollup.accepted = z.works.filter((w: any) => ACCEPTED.includes(w.status)).length;
  z.rollup.pct = z.rollup.total ? z.rollup.accepted / z.rollup.total : 0;
  // A reworked case re-attaches the same survey/inspection; dedup the doc list.
  const seen = new Set<string>();
  z.documents = z.documents.filter((d: any) => { const k = d.kind + "|" + (d.ref || ""); if (seen.has(k)) return false; seen.add(k); return true; });
}

// --- timeline.json (events + per-zone accepted-stage history) ---------------
const tlEvents: any[] = [];
for (const c of cases) {
  for (const e of c.events as any[]) {
    const ev: any = { at: e.at, kind: e.type.split(".")[0], actor: e.actor, gate: c.state.gateId, zone: c.zone ?? null, phase: c.phase, system: c.system ?? null };
    if (e.type === "claim.submitted") ev.verb = "claimed";
    else if (e.type === "evidence.attached") { ev.verb = "attached"; ev.evidenceKind = e.evidence.kind; ev.docClass = docClass(e.evidence.kind); ev.ref = e.evidence.ref; }
    else if (e.type === "decision.recorded") {
      ev.verb = e.outcome; ev.outcome = e.outcome; ev.note = e.note;
      if (ACCEPTED.includes(e.outcome)) {
        const m = moneyEffect(c.state);
        if (m && (m.net ?? 0) !== 0) ev.money = { net: m.net, gross: m.gross, retention: m.retention, currency: m.currency, estimateLine: m.estimateLine };
      }
    }
    tlEvents.push(ev);
  }
}
tlEvents.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind > b.kind ? 1 : -1));
tlEvents.forEach((e, i) => (e.seq = i));

// per-zone accepted-stage history (for the at-t recolor; precomputed, no re-fold)
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
// Roof closure is covered under the envelope/handover scope (no separate КС-3
// line); add a visualization-only milestone so the roof rises with the frame.
const roofAt = iso(Math.max(...cases.filter((c) => c.system === "structure" && c.state.decidedAt).map((c) => Date.parse(c.state.decidedAt!))));
for (const rid of ["BLDG-R01", "BLDG-R02"]) stageByZone[rid] = [{ at: roofAt, stage: "roof", system: null, phase: "roof", systemsDone: 1 }];

const range = { minAt: tlEvents[0].at, maxAt: tlEvents[tlEvents.length - 1].at };

// --- ledger.json (КС-3 periods, retention reserve, advance recovery) --------
const period = (at: string) => at.slice(0, 7); // YYYY-MM
const periodsMap = new Map<string, any>();
for (const c of cases) {
  const m = moneyEffect(c.state);
  if (!m || !ACCEPTED.includes(c.state.status) || !c.state.decidedAt) continue;
  if (c.phase === "advance" || c.phase === "release" || c.phase === "design") continue; // design (ПИР) + advance + release are not construction КС-3 earned value
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
  // Recover the advance against each period's GROSS certified volume (15% of the
  // КС-2 gross), so the 15%-of-contract advance fully amortizes by completion.
  const recovery = Math.min(advRemaining, Math.round(e.gross * advancePct * 100) / 100);
  advRemaining = Math.round((advRemaining - recovery) * 100) / 100;
  return {
    periodLabel: e.periodLabel, ks3Id: "КС-3 " + e.periodLabel, lines: e.lines,
    gross: round2(e.gross), certifiedNet: round2(e.certifiedNet), retentionThisPeriod: round2(e.retentionThisPeriod),
    advanceRecovery: recovery, vatMemo: round2(e.vatMemo), netPayment: round2(e.certifiedNet - recovery),
    paymentDueAt: addDays(e.lastDue, 0),
  };
});
function round2(x: number) { return Math.round(x * 100) / 100; }
const ledger = {
  currency: "EUR",
  contractValue: round2(constructionValue), designFee: 480000,
  advance: { issued: advanceBase, issuedAt: project.schedule.preConstruction.advance_at, recovered: round2(advanceBase - advRemaining), outstanding: round2(advRemaining) },
  retention: { held: reserve, released: round2(tranche1 + tranche2), reserve: round2(reserve - tranche1 - tranche2), tranche1, tranche2, tranche1At: t1At, tranche2At: t2At },
  periods,
};

// --- certificate.json (EVM PV/EV/AC + КС-3 line detail) ---------------------
const moneyCases = cases.filter((c) => moneyEffect(c.state) && ACCEPTED.includes(c.state.status) && c.phase !== "advance" && c.phase !== "release" && c.phase !== "design");
const acwp = 1 + fr.acwpOverrunPct;
// Sample bi-weekly across the construction span so the dispute-driven schedule
// slip (actual decidedAt ~1 month later than the planned on-time date) shows up
// as SPI dipping below 1 and recovering — not a flat 1.00 at monthly granularity.
const evMin = Math.min(...moneyCases.map((c) => Math.min(Date.parse(c.state.decidedAt!), Date.parse(c.plannedAt))));
const evMax = Math.max(...moneyCases.map((c) => Math.max(Date.parse(c.state.decidedAt!), Date.parse(c.plannedAt))));
const sampleDates: string[] = [];
for (let t = evMin; t < evMax; t += 14 * DAY) sampleDates.push(iso(t));
sampleDates.push(iso(evMax));
const cum = (dates: string[], pick: (c: Case) => { at: string; v: number }) => dates.map((at) => {
  let v = 0; for (const c of moneyCases) { const x = pick(c); if (Date.parse(x.at) <= Date.parse(at)) v += x.v; } return { at, cum: round2(v) };
});
// PV is the PLANNED baseline (on-time dates, plannedNet); EV is folded-state
// actual (decidedAt, net). They diverge wherever a dispute slipped acceptance.
// BAC = planned total (the budget), independent of how completion actually went.
// AC is ILLUSTRATIVE — actual contractor cost is the one figure the engine does
// not own; here it is EV inflated by a fixed overrun (acwp) + a seeded jitter.
const bac = round2(moneyCases.reduce((s, c) => s + c.plannedNet, 0));
const pv = cum(sampleDates, (c) => ({ at: c.plannedAt, v: c.plannedNet }));
const ev = cum(sampleDates, (c) => ({ at: c.state.decidedAt!, v: moneyEffect(c.state)!.net ?? 0 }));
const ac = cum(sampleDates, (c) => ({ at: c.state.decidedAt!, v: round2((moneyEffect(c.state)!.net ?? 0) * acwp * (1 + (seed(c.id) % 7 - 3) / 100)) }));
const spiCpiAt = sampleDates.map((at, i) => ({ at, spi: pv[i].cum ? round2(ev[i].cum / pv[i].cum) : 1, cpi: ac[i].cum ? round2(ev[i].cum / ac[i].cum) : 1 }));
const ks3 = periods.map((p) => ({
  ks3Id: p.ks3Id, period: p.periodLabel,
  lines: moneyCases.filter((c) => period(c.state.decidedAt!) === p.periodLabel).map((c) => {
    const m = moneyEffect(c.state)!;
    return { estimateLine: m.estimateLine, zone: c.zone, system: c.system ?? c.phase, quantity: m.quantity, unitPrice: m.unitPrice, gross: m.gross, retention: m.retention, net: m.net, vat: m.vat };
  }),
  totals: { gross: p.gross, retention: p.retentionThisPeriod, net: p.certifiedNet, vat: p.vatMemo },
}));
const certificate = { currency: "EUR", asOfMax: range.maxAt, evm: { pv, ev, ac, bac }, spiCpiAt, ks3 };

// --- validation + write -----------------------------------------------------
const issues = lintZones(states, model);
writeFileSync(join(OUT, "attachments.json"), JSON.stringify(byZone, null, 2) + "\n");
writeFileSync(join(OUT, "timeline.json"), JSON.stringify({ range, events: tlEvents, stageByZone }, null, 2) + "\n");
writeFileSync(join(OUT, "ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
writeFileSync(join(OUT, "certificate.json"), JSON.stringify(certificate, null, 2) + "\n");
writeFileSync(join(OUT, "roles.json"), JSON.stringify({ roles: project.roles, acts: project.acts, object: project.object }, null, 2) + "\n");

// --- console summary --------------------------------------------------------
const accepted = cases.filter((c) => ACCEPTED.includes(c.state.status)).length;
const disputed = cases.filter((c) => c.state.log.some((l) => l.includes("returned_for_rework"))).length;
const totalNet = round2(moneyCases.reduce((s, c) => s + (moneyEffect(c.state)!.net ?? 0), 0));
console.log(`E2E fold complete — ${cases.length} acceptance cases (${accepted} accepted), ${disputed} went through dispute/rework.`);
console.log(`Zones touched: ${Object.keys(byZone).length}. Timeline events: ${tlEvents.length} (${range.minAt.slice(0,10)} → ${range.maxAt.slice(0,10)}).`);
console.log(`Contract value €${ledger.contractValue.toLocaleString("en-US")} · advance €${advanceBase.toLocaleString("en-US")} · earned value (net КС-3) €${totalNet.toLocaleString("en-US")} · retention reserve €${reserve.toLocaleString("en-US")} (released ${ledger.retention.released}).`);
console.log(`Lint: ${issues.length ? issues.length + " issue(s): " + issues.map((i) => i.kind).join(", ") : "ok — every referenced zone exists in the model, no duplicate acceptances"}.`);
console.log(`Wrote viz/model/e2e/{attachments,timeline,ledger,certificate,roles}.json`);
