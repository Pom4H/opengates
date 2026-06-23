import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createOutbox,
  deliver,
  fold,
  loadGate,
  loadScenario,
  pending,
  type FiredEffect,
  type GateDefinition,
} from "../src/index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(here + rel, "utf8"));
const gate: GateDefinition = loadGate(read("../../examples/construction/gate.json"));
const accept = () => loadScenario(read("../../examples/construction/scenario.accept.json")).events;

test("effectId is stable across replays of the same decision", () => {
  const a = fold(gate, accept()).consequences.map((c) => c.effectId).sort();
  const b = fold(gate, accept()).consequences.map((c) => c.effectId).sort();
  assert.deepEqual(a, b);
  assert.ok(a.every((id) => /^[0-9a-f]{16}$/.test(id)));
});

test("outbox delivers each effect once, even when called repeatedly", async () => {
  const effects: FiredEffect[] = fold(gate, accept()).consequences;
  assert.ok(effects.length >= 3);

  const outbox = createOutbox();
  const paid: string[] = [];
  const send = async (e: FiredEffect) => void paid.push(e.effectId);

  const first = await deliver(outbox, effects, send);
  assert.equal(first.delivered.length, effects.length);
  assert.equal(first.skipped.length, 0);

  // Replay: nothing delivered twice.
  const second = await deliver(outbox, effects, send);
  assert.equal(second.delivered.length, 0);
  assert.equal(second.skipped.length, effects.length);

  assert.equal(paid.length, effects.length); // exactly once total
  assert.equal(pending(outbox, effects).length, 0);
});
