import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateOnce, ensemble } from "../../../examples/construction/sim/build-sim.ts";

test("a run is replayable — same seed ⇒ identical outcome", () => {
  const a = simulateOnce(7);
  const b = simulateOnce(7);
  assert.equal(a.finishDate, b.finishDate);
  assert.equal(a.acceptedNet, b.acceptedNet);
  assert.equal(a.disputes, b.disputes);
  assert.equal(a.finishDay, b.finishDay);
});

test("the simulated world folds through the engine to accepted, paid facts", () => {
  const r = simulateOnce(3);
  assert.ok(r.states.length > 0);
  // Every pour ends accepted (disputed ones via rework), and money is positive.
  assert.ok(r.states.every((s) => s.status === "accepted"));
  assert.ok(r.acceptedNet > 0);
});

test("the crane is the bottleneck — never exceeds its capacity", () => {
  const r = simulateOnce(11);
  assert.equal(r.cranePeak, 1);
});

test("the resource ledger balances — consumption never exceeds accepted supply", () => {
  const r = simulateOnce(5);
  assert.ok(r.rebarIn >= r.rebarOut);
});

test("an ensemble produces a real schedule distribution (P90 ≥ P50 ≥ P10)", () => {
  const e = ensemble(Array.from({ length: 60 }, (_, i) => i + 1));
  assert.ok(e.finishP[2] >= e.finishP[1] && e.finishP[1] >= e.finishP[0]);
  // Reality bites: the worst case is meaningfully later than the best.
  assert.ok(e.finishP[2] > e.finishP[0]);
});

test("earned value is paid on the surveyed reality, so it is stable across worlds", () => {
  // Different seeds slip the schedule but accept the same surveyed quantities.
  const a = simulateOnce(1).acceptedNet;
  const b = simulateOnce(99).acceptedNet;
  assert.equal(a, b);
});
