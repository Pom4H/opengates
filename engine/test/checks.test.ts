import { test } from "node:test";
import assert from "node:assert/strict";

import { runChecks, type Check, type ClaimValue, type EvidenceValue, type GateDefinition } from "../src/index.ts";

function gateWith(check: Check): GateDefinition {
  return {
    id: "t",
    name: "t",
    domain: "t",
    claim: { type: "t", fields: [] },
    evidence: [],
    checks: [check],
    reviewer: { role: "r" },
    decisions: ["accepted"],
    consequences: [],
  };
}

function run(check: Check, claim: ClaimValue | undefined, evidence: EvidenceValue[]) {
  return runChecks(gateWith(check), claim, evidence)[0];
}

const claim = (quantity: number, unit = "m3"): ClaimValue => ({ type: "t", values: { quantity, unit } });
const survey = (quantity: number, extra: Record<string, string | number> = {}): EvidenceValue => ({
  kind: "executive_survey",
  values: { quantity, unit: "m3", ...extra },
});

const cross: Check = {
  id: "x",
  rule: "cross_check",
  claimField: "quantity",
  claimUnit: "m3",
  evidenceKind: "executive_survey",
  evidenceField: "quantity",
  uncertaintyField: "U",
  requireUnitMatch: true,
  tolerance: 0.05,
  absolute: 2,
};

test("cross_check: within tolerance and uncertainty passes", () => {
  const r = run(cross, claim(120), [survey(117, { U: 4 })]);
  assert.equal(r.outcome, "pass");
  assert.match(r.detail ?? "", /2.56% of ref 117/);
});

test("cross_check: error normalized by the REFERENCE, not the claim", () => {
  // 120 vs 100 -> |20|/100 = 20% of reference (not 16.7% of claim).
  const r = run(cross, claim(120), [survey(100, { U: 4 })]);
  assert.equal(r.outcome, "fail");
  assert.match(r.detail ?? "", /20.00% of ref 100/);
});

test("cross_check: the uncertainty band can bind even inside the percentage tolerance", () => {
  const loose: Check = { ...cross, tolerance: 0.1, absolute: undefined } as Check;
  // |108-100| = 8 -> 8% <= 10% tolerance, but U is 5 -> outside the band.
  const r = run(loose, claim(108), [survey(100, { U: 5 })]);
  assert.equal(r.outcome, "fail");
  assert.match(r.detail ?? "", /U=5/);
});

test("cross_check: the absolute floor wins for small references (whichever greater)", () => {
  // ref 10, claim 11.5: rel limit = 0.5, absolute = 2 -> limit 2; |1.5| <= 2 passes.
  const r = run(cross, claim(11.5), [survey(10)]);
  assert.equal(r.outcome, "pass");
});

test("cross_check: a unit mismatch fails fast", () => {
  const r = run(cross, claim(120, "m3"), [survey(117, { unit: "ft3", U: 4 })]);
  assert.equal(r.outcome, "fail");
  assert.match(r.detail ?? "", /unit mismatch/);
});

test("cross_check: skipped until the reference is attached", () => {
  assert.equal(run(cross, claim(120), []).outcome, "skipped");
});

const window: Check = {
  id: "w",
  rule: "date_window",
  field: "delivered_at",
  start: "2026-06-10T08:00:00Z",
  end: "2026-06-10T18:00:00Z",
};

test("date_window: a date inside the window passes, outside fails, absent skips", () => {
  const at = (v?: string): ClaimValue => ({ type: "t", values: v ? { delivered_at: v } : {} });
  assert.equal(run(window, at("2026-06-10T12:00:00Z"), []).outcome, "pass");
  assert.equal(run(window, at("2026-06-11T09:00:00Z"), []).outcome, "fail");
  assert.equal(run(window, at(undefined), []).outcome, "skipped");
});

test("warning checks never block; blocking checks do", () => {
  const warn: Check = { ...cross, id: "w2", severity: "warning" } as Check;
  const r = run(warn, claim(120), [survey(100, { U: 4 })]);
  assert.equal(r.outcome, "fail");
  assert.equal(r.severity, "warning");
});
