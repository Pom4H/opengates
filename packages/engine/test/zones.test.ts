import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  attachmentsByZone,
  fold,
  indexByZone,
  lintZones,
  loadGate,
  loadScenario,
  runChecks,
  zoneOf,
  type GateDefinition,
} from "../src/index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(here + rel, "utf8"));

// examples live at the repo root, three levels up from packages/engine/test/.
const sys = "../../../examples/construction/systems/";
const gate: GateDefinition = loadGate(read(sys + "gate.json"));
const scenarios = [
  loadScenario(read(sys + "structure.accept.json")),
  loadScenario(read(sys + "envelope.accept.json")),
  loadScenario(read(sys + "mep.review.json")),
  loadScenario(read(sys + "fitout.submitted.json")),
];
const states = scenarios.map((s) => fold(gate, s.events));

test("zoneOf reads the zone a claim is anchored to", () => {
  assert.equal(zoneOf(states[0]), "A1-F03");
});

test("indexByZone collects every work attached to a zone", () => {
  const byZone = indexByZone(states);
  const a = byZone.get("A1-F03");
  assert.ok(a);
  assert.equal(a.works.length, 4);
  const titles = a.works.map((w) => w.title).sort();
  assert.deepEqual(titles, ["envelope", "fit-out", "mep", "structure"]);
});

test("rollup counts accepted works and sums their net money", () => {
  const a = indexByZone(states).get("A1-F03");
  assert.equal(a?.rollup.total, 4);
  assert.equal(a?.rollup.accepted, 2); // structure + envelope
  assert.equal(a?.rollup.pct, 0.5);
  const accepted = a?.works.filter((w) => w.status === "accepted") ?? [];
  assert.equal(accepted.length, 2);
  for (const w of accepted) {
    assert.equal(w.amount, 840); // 14 m2 × €60, no retention
    assert.equal(w.currency, "EUR");
  }
});

test("pending works carry no money", () => {
  const a = indexByZone(states).get("A1-F03");
  const mep = a?.works.find((w) => w.title === "mep");
  assert.equal(mep?.status, "under_review");
  assert.equal(mep?.amount, undefined);
});

test("documents from every work are attached to the zone", () => {
  const a = indexByZone(states).get("A1-F03");
  // 3 inspections + 1 photo_log across the four works
  assert.equal(a?.documents.length, 4);
  const refs = a?.documents.map((d) => d.ref) ?? [];
  assert.ok(refs.includes("inspect/A1-F03-structure.pdf"));
  assert.ok(refs.includes("photos/A1-F03-envelope/"));
});

test("attachmentsByZone returns a plain JSON-able object", () => {
  const obj = attachmentsByZone(states);
  assert.equal(Object.keys(obj).length, 1);
  assert.ok(obj["A1-F03"]);
  assert.doesNotThrow(() => JSON.stringify(obj));
});

test("field_pattern check validates the zone id format", () => {
  const good = runChecks(gate, { type: "system_work_completed", values: { zone: "A1-F03" } }, []);
  assert.equal(good.find((c) => c.id === "zone-format")?.outcome, "pass");

  const bad = runChecks(gate, { type: "system_work_completed", values: { zone: "nonsense" } }, []);
  assert.equal(bad.find((c) => c.id === "zone-format")?.outcome, "fail");
});

test("field_pattern is skipped until the field is present", () => {
  const none = runChecks(gate, { type: "system_work_completed", values: {} }, []);
  assert.equal(none.find((c) => c.id === "zone-format")?.outcome, "skipped");
});

test("lintZones flags a claim anchored to a zone not in the model", () => {
  const model = { zones: [{ id: "A1-F03" }, { id: "B2-F01" }] };
  const clean = lintZones(states, model);
  assert.equal(clean.filter((i) => i.kind === "unknown_zone").length, 0);

  const ghost = fold(
    gate,
    loadScenario({
      gate: gate.id,
      events: [
        {
          type: "claim.submitted",
          at: "2026-01-01T00:00:00Z",
          actor: "x",
          claim: { type: "system_work_completed", values: { system: "structure", quantity: 1, zone: "Z9-F99" } },
        },
      ],
    }).events,
  );
  const issues = lintZones([ghost], model);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "unknown_zone");
});

test("lintZones flags the same system accepted twice on a zone", () => {
  // structure.accept folded twice = a duplicate acceptance of the same system
  const dup = [states[0], fold(gate, scenarios[0].events)];
  const issues = lintZones(dup);
  const dupes = issues.filter((i) => i.kind === "duplicate_acceptance");
  assert.equal(dupes.length, 1);
  assert.match(dupes[0].detail, /structure/);
});

test("states without a zone are ignored", () => {
  const plainGate = loadGate(read("../../../examples/construction/gate.json"));
  const noZone = fold(
    plainGate,
    loadScenario({
      gate: plainGate.id,
      events: [
        {
          type: "claim.submitted",
          at: "2026-01-01T00:00:00Z",
          actor: "x",
          claim: { type: "work_volume_completed", values: { quantity: 1 } },
        },
      ],
    }).events,
  );
  assert.equal(indexByZone([noZone]).size, 0);
});
