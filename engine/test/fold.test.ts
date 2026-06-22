import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  autodecide,
  fold,
  loadGate,
  type GateDefinition,
  type Scenario,
} from "../src/index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(here + rel, "utf8"));

const gate: GateDefinition = loadGate(read("../../examples/construction/gate.json"));
const accept: Scenario = read("../../examples/construction/scenario.accept.json");
const dispute: Scenario = read("../../examples/construction/scenario.dispute.json");

test("happy path: claim within tolerance is accepted and becomes payable", () => {
  const state = fold(gate, accept.events);

  assert.equal(state.status, "accepted");
  assert.equal(state.checksPassed, true);
  assert.equal(state.decision?.outcome, "accepted");

  // Responsibility transfers to the reviewer role.
  assert.ok(state.responsibility);
  assert.equal(state.responsibility?.role, "technical_supervisor");

  // Economic consequence: 120 m3 * 85 EUR = 10200 EUR earned value.
  const money = state.consequences.find((c) => c.effect === "money");
  assert.equal(money?.amount, 10200);
  assert.equal(money?.currency, "EUR");

  // Right to proceed is released.
  const proceed = state.consequences.find((c) => c.effect === "right_to_proceed");
  assert.equal(proceed?.unlocks, "WP-foundation-closeout");

  // A labelled dataset record accumulates for future automation.
  assert.equal(state.datasetLabel?.label, "accepted");
  assert.equal(state.datasetLabel?.dataset, "construction.work_acceptance");
});

test("dispute path: claim outside tolerance fails cross-check and is returned", () => {
  const state = fold(gate, dispute.events);

  assert.equal(state.checksPassed, false);
  const cross = state.checks.find((c) => c.rule === "cross_check");
  assert.equal(cross?.outcome, "fail");

  assert.equal(state.status, "returned_for_rework");
  // No money is released on a returned claim.
  assert.equal(
    state.consequences.find((c) => c.effect === "money"),
    undefined,
  );
  assert.equal(state.datasetLabel?.label, "returned_for_rework");
});

test("acceptance is blocked while blocking checks have not passed", () => {
  const state = fold(gate, [
    {
      type: "claim.submitted",
      at: "2026-06-01T00:00:00Z",
      actor: "contractor:x",
      claim: { type: "work_volume_completed", values: { work_item: "x", quantity: 120, period: "2026-05" } },
    },
    // No survey evidence attached -> required_evidence + cross_check unmet.
    {
      type: "decision.recorded",
      at: "2026-06-02T00:00:00Z",
      actor: "supervisor:y",
      reviewerRole: "technical_supervisor",
      outcome: "accepted",
    },
  ]);

  assert.equal(state.checksPassed, false);
  assert.equal(state.status, "under_review");
  assert.equal(state.decision, undefined);
  assert.equal(state.consequences.length, 0);
});

test("a decision from the wrong role is ignored", () => {
  const state = fold(gate, [
    ...accept.events.slice(0, -1),
    {
      type: "decision.recorded",
      at: "2026-06-03T00:00:00Z",
      actor: "contractor:x",
      reviewerRole: "contractor",
      outcome: "accepted",
    },
  ]);

  assert.equal(state.decision, undefined);
  assert.ok(state.log.some((l) => l.includes("ignored")));
});

test("autodecide stays human for high-value claims, fires for small ones", () => {
  // State after claim + evidence, before any human decision.
  const big = fold(gate, accept.events.slice(0, -1));
  assert.equal(big.checksPassed, true);
  // 10200 EUR exceeds the policy maxAmount (2000) -> no automation.
  assert.equal(autodecide(gate, big), null);

  // A small claim within the policy limit can be automated.
  const small = fold(gate, [
    {
      type: "claim.submitted",
      at: "2026-06-01T00:00:00Z",
      actor: "contractor:x",
      claim: { type: "work_volume_completed", values: { work_item: "minor patch", quantity: 10, period: "2026-05" } },
    },
    {
      type: "evidence.attached",
      at: "2026-06-02T00:00:00Z",
      actor: "surveyor:z",
      evidence: { kind: "survey_measurement", values: { quantity: 10 } },
    },
  ]);
  const auto = autodecide(gate, small, "2026-06-03T00:00:00Z");
  assert.ok(auto);
  assert.equal(auto?.outcome, "accepted");
  assert.equal(auto?.actor, "system:auto");

  // Replaying the auto-decision yields an accepted, payable state (10 * 85).
  const decided = fold(gate, [
    {
      type: "claim.submitted",
      at: "2026-06-01T00:00:00Z",
      actor: "contractor:x",
      claim: { type: "work_volume_completed", values: { work_item: "minor patch", quantity: 10, period: "2026-05" } },
    },
    {
      type: "evidence.attached",
      at: "2026-06-02T00:00:00Z",
      actor: "surveyor:z",
      evidence: { kind: "survey_measurement", values: { quantity: 10 } },
    },
    auto,
  ]);
  assert.equal(decided.status, "accepted");
  assert.equal(decided.consequences.find((c) => c.effect === "money")?.amount, 850);
});
