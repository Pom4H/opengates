import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  autodecide,
  fold,
  loadGate,
  loadScenario,
  normalizeLog,
  type FiredEffect,
  type GateDefinition,
  type GateEvent,
} from "../src/index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(here + rel, "utf8"));
const events = (rel: string): GateEvent[] => loadScenario(read(rel)).events;

const gate: GateDefinition = loadGate(read("../../../examples/construction/gate.json"));
const accept = () => events("../../../examples/construction/scenario.accept.json");
const dispute = () => events("../../../examples/construction/scenario.dispute.json");
const remarks = () => events("../../../examples/construction/scenario.remarks.json");

const money = (s: { consequences: FiredEffect[] }) =>
  s.consequences.find((c) => c.effect === "money")?.payload as Record<string, number> | undefined;

test("accept: pays the ACCEPTED quantity (117), not the claimed (120), less retention", () => {
  const state = fold(gate, accept());

  assert.equal(state.status, "accepted");
  assert.equal(state.checksPassed, true);
  assert.equal(state.decision?.outcome, "accepted");
  assert.equal(state.responsibility?.role, "technical_supervisor");

  const m = money(state);
  assert.equal(m?.quantity, 117); // accepted, not 120 claimed
  assert.equal(m?.quantitySource as unknown as string, "accepted");
  assert.equal(m?.gross, 9945); // 117 × 85
  assert.equal(m?.retention, 497.25); // 5%
  assert.equal(m?.net, 9447.75); // certified
  assert.equal(m?.vat, 1889.55); // 20% memo of net

  const proceed = state.consequences.find((c) => c.effect === "right_to_proceed");
  assert.equal(proceed?.payload.unlocks, "WP-foundation-closeout");

  // Cycle time is derived from event timestamps (free FP&A signal).
  assert.equal(state.cycleDays, 2.25); // 2026-06-01T09:00 -> 2026-06-03T15:00

  // Labelled record carries claimed AND accepted, for the dataset.
  assert.equal(state.datasetLabel?.label, "accepted");
  const feats = state.datasetLabel?.features as { claimed: Record<string, number>; accepted: Record<string, number> };
  assert.equal(feats.claimed.quantity, 120);
  assert.equal(feats.accepted.quantity, 117);
});

test("dispute: claim 120 vs survey 100 fails the reference cross-check; nothing certified", () => {
  const state = fold(gate, dispute());

  assert.equal(state.checksPassed, false);
  const cross = state.checks.find((c) => c.rule === "cross_check");
  assert.equal(cross?.outcome, "fail");
  assert.match(cross?.detail ?? "", /20\.00% of ref 100/);

  assert.equal(state.status, "returned_for_rework");
  assert.equal(money(state), undefined); // money fires only on acceptance
  assert.equal(state.datasetLabel?.label, "returned_for_rework");
});

test("remarks: accepted_with_exceptions pays the accepted 118 m³ and holds retention", () => {
  const state = fold(gate, remarks());
  assert.equal(state.status, "accepted_with_exceptions");
  const m = money(state);
  assert.equal(m?.quantity, 118);
  assert.equal(m?.gross, 10030); // 118 × 85
  assert.equal(m?.net, 9528.5);
});

test("acceptance is blocked while blocking checks have not passed", () => {
  const log = normalizeLog("case", [
    {
      type: "claim.submitted",
      at: "2026-06-01T00:00:00Z",
      actor: "contractor:x",
      claim: { type: "work_volume_completed", values: { work_item: "x", quantity: 120, period: "2026-05" } },
    },
    // No evidence -> required_evidence + cross_check unmet.
    {
      type: "decision.recorded",
      at: "2026-06-02T00:00:00Z",
      actor: "supervisor:y",
      reviewerRole: "technical_supervisor",
      outcome: "accepted",
    },
  ]);
  const state = fold(gate, log);
  assert.equal(state.checksPassed, false);
  assert.equal(state.status, "under_review");
  assert.equal(state.decision, undefined);
  assert.equal(state.consequences.length, 0);
});

test("a decision from the wrong role is ignored", () => {
  const log = [
    ...accept().slice(0, -1),
    ...normalizeLog("wrong", [
      {
        type: "decision.recorded",
        at: "2026-06-03T00:00:00Z",
        actor: "contractor:x",
        reviewerRole: "contractor",
        outcome: "accepted",
        seq: accept().length,
      },
    ]),
  ];
  const state = fold(gate, log as GateEvent[]);
  assert.equal(state.decision, undefined);
  assert.ok(state.log.some((l) => l.includes("ignored")));
});

// --- the durable-execution properties the README sells -----------------------

test("deterministic: folding the same log twice yields byte-identical state", () => {
  assert.deepEqual(fold(gate, accept()), fold(gate, accept()));
});

test("idempotent: a redelivered event (same id) is a no-op", () => {
  const log = accept();
  const withDup = [log[0], log[1], log[1], ...log.slice(2)]; // event #2 redelivered
  assert.deepEqual(fold(gate, withDup), fold(gate, log));
});

test("idempotent: replaying the entire log twice changes nothing", () => {
  const log = accept();
  assert.deepEqual(fold(gate, [...log, ...log]), fold(gate, log));
});

test("out-of-order events are rejected", () => {
  const log = accept();
  assert.throws(() => fold(gate, [log[0], log[2]]), /out-of-order/);
});

test("replayable: fold reads no wall clock and no randomness", () => {
  const realNow = Date.now;
  const realRand = Math.random;
  Date.now = () => {
    throw new Error("fold must not read Date.now()");
  };
  Math.random = () => {
    throw new Error("fold must not read Math.random()");
  };
  try {
    assert.equal(fold(gate, accept()).status, "accepted");
  } finally {
    Date.now = realNow;
    Math.random = realRand;
  }
});

test("autodecide: requires the trigger time and respects the value ceiling", () => {
  // Above the ceiling: 117 × 85 net 9 447.75 > maxAmount 2000 -> stays human.
  const big = fold(gate, accept().slice(0, -1));
  assert.equal(big.checksPassed, true);
  assert.equal(autodecide(gate, big, "2026-06-03T00:00:00Z"), null);

  // A small, fully-evidenced claim within the ceiling auto-accepts.
  const smallLog = normalizeLog("small", [
    {
      type: "claim.submitted",
      at: "2026-06-01T00:00:00Z",
      actor: "contractor:x",
      claim: { type: "work_volume_completed", values: { work_item: "minor patch", quantity: 10, period: "2026-05" } },
    },
    { type: "evidence.attached", at: "2026-06-02T00:00:00Z", actor: "surveyor:z", evidence: { kind: "executive_survey", values: { quantity: 10, unit: "m3" } } },
    { type: "evidence.attached", at: "2026-06-02T00:01:00Z", actor: "lab:l", evidence: { kind: "concrete_strength_protocol", ref: "l.pdf" } },
    { type: "evidence.attached", at: "2026-06-02T00:02:00Z", actor: "c", evidence: { kind: "works_log", ref: "w.pdf" } },
    { type: "evidence.attached", at: "2026-06-02T00:03:00Z", actor: "c", evidence: { kind: "aosr_ref", ref: "a.pdf" } },
  ]);
  const small = fold(gate, smallLog);
  const auto = autodecide(gate, small, "2026-06-03T00:00:00Z");
  assert.ok(auto);
  assert.equal(auto?.outcome, "accepted");
  assert.equal(auto?.actor, "system:auto");

  // Replaying the auto-decision is deterministic and pays the small net (807.50).
  const decided = fold(gate, [...smallLog, auto]);
  assert.equal(decided.status, "accepted");
  assert.equal(money(decided)?.net, 807.5); // 10 × 85 = 850, less 5% retention
});
