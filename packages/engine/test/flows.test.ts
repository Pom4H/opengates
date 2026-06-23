import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  flowGraph,
  flowOf,
  flowsOf,
  fold,
  lintFlows,
  loadGate,
  loadScenario,
  resourceLedger,
  type GateDefinition,
  type OperationalModel,
} from "../src/index.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(here + rel, "utf8"));

const ops = "../../../examples/operations/";
const sys = "../../../examples/construction/systems/";

const flowGate: GateDefinition = loadGate(read(ops + "flow.gate.json"));
const sysGate: GateDefinition = loadGate(read(sys + "gate.json"));
const model: OperationalModel = read("../../../viz/model/graph.json");

const flowState = (rel: string) => fold(flowGate, loadScenario(read(ops + rel)).events);
const sysState = (rel: string) => fold(sysGate, loadScenario(read(sys + rel)).events);

const deliverRebar = flowState("deliver-rebar.accept.json");
const rentCrane = flowState("rent-crane.accept.json");
const transportCrew = flowState("transport-crew.accept.json");
const consumeRebar = flowState("consume-rebar.json");
const consumeCrane = flowState("consume-crane.json");
const consumeCrew = flowState("consume-crew.json");
const structure = sysState("structure.accept.json");

const all = [deliverRebar, rentCrane, transportCrew, consumeRebar, consumeCrane, consumeCrew, structure];

test("flowOf reads an explicit deliver flow and derives its accepted status", () => {
  const f = flowOf(deliverRebar);
  assert.ok(f);
  assert.equal(f.kind, "deliver");
  assert.equal(f.resource, "MAT-rebar");
  assert.equal(f.from, "SUP-rebar");
  assert.equal(f.to, "MAT-rebar");
  assert.equal(f.qty, 24);
  assert.equal(f.acceptedQty, 23.8);
  assert.equal(f.status, "accepted");
});

test("flowOf reads flowKind for a rental", () => {
  assert.equal(flowOf(rentCrane)?.kind, "rent");
});

test("flowOf synthesizes a produce edge from a zone+system acceptance", () => {
  const f = flowOf(structure);
  assert.ok(f);
  assert.equal(f.kind, "produce");
  assert.equal(f.from, "SYS-A1-F03-structure");
  assert.equal(f.to, "A1-F03");
  assert.equal(f.status, "accepted");
  assert.equal(f.amount, 840); // 14 m2 × €60, joins the existing construction money
});

test("flowOf returns undefined for a non-flow state", () => {
  const plainGate = loadGate(read("../../../examples/construction/gate.json"));
  const noFlow = fold(
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
  assert.equal(flowOf(noFlow), undefined);
});

test("flowGraph builds nodes + gate-backed edges and pulls anchor metadata from the model", () => {
  const g = flowGraph(all, model);
  assert.equal(g.edges.length, 7);
  const rebar = g.nodes.find((n) => n.id === "MAT-rebar");
  assert.equal(rebar?.kind, "resource");
  assert.equal(rebar?.resourceKind, "material");
});

test("flowGraph synthesizes a capital_work node when the model omits it", () => {
  const g = flowGraph([structure]); // no model
  const sysNode = g.nodes.find((n) => n.id === "SYS-A1-F03-structure");
  assert.equal(sysNode?.kind, "capital_work");
});

test("resourceLedger counts accepted inflow against consumption (mass balance)", () => {
  const ledger = resourceLedger(all, model);
  const rebar = ledger.get("MAT-rebar");
  assert.ok(rebar);
  assert.equal(rebar.in, 23.8); // the *accepted* delivery (weighbridge), not the claimed 24
  assert.equal(rebar.out, 3.2); // consumed into the structure
  assert.equal(Number(rebar.remaining.toFixed(4)), 20.6);
  assert.equal(rebar.unit, "t");

  const crane = ledger.get("EQ-crane-1");
  assert.equal(crane?.in, 39.5); // accepted telematics hours, not the claimed 40
  assert.equal(crane?.out, 8); // 8 machine-h used on the structure
  assert.equal(crane?.remaining, 31.5);

  const crew = ledger.get("CREW-concrete");
  assert.equal(crew?.in, 64);
  assert.equal(crew?.out, 16);
});

test("an un-accepted delivery does not count as available stock", () => {
  const submittedOnly = fold(
    flowGate,
    loadScenario({
      gate: flowGate.id,
      events: [
        {
          type: "claim.submitted",
          at: "2026-01-01T00:00:00Z",
          actor: "x",
          claim: { type: "resource_flow", values: { flowKind: "deliver", resource: "MAT-rebar", qty: 10, unit: "t", from: "SUP-rebar", to: "SITE-goodsin" } },
        },
      ],
    }).events,
  );
  const rebar = resourceLedger([submittedOnly]).get("MAT-rebar");
  assert.equal(rebar?.in, 0);
});

test("lintFlows is clean for the worked path", () => {
  assert.deepEqual(lintFlows(all, model), []);
});

test("lintFlows flags negative stock when consumption exceeds accepted supply", () => {
  const overConsume = fold(
    flowGate,
    loadScenario({
      gate: flowGate.id,
      events: [
        {
          type: "claim.submitted",
          at: "2026-01-02T00:00:00Z",
          actor: "x",
          claim: { type: "resource_flow", values: { flowKind: "consume", resource: "MAT-rebar", qty: 99, unit: "t", from: "MAT-rebar", to: "SYS-A1-F03-structure" } },
        },
      ],
    }).events,
  );
  const issues = lintFlows([deliverRebar, overConsume], model);
  assert.equal(issues.filter((i) => i.kind === "negative_stock").length, 1);
});

test("lintFlows flags a flow referencing an anchor not in the model", () => {
  const ghost = fold(
    flowGate,
    loadScenario({
      gate: flowGate.id,
      events: [
        {
          type: "claim.submitted",
          at: "2026-01-03T00:00:00Z",
          actor: "x",
          claim: { type: "resource_flow", values: { flowKind: "deliver", resource: "MAT-rebar", qty: 1, unit: "t", from: "SUP-ghost", to: "MAT-rebar" } },
        },
      ],
    }).events,
  );
  const issues = lintFlows([ghost], model);
  assert.equal(issues.filter((i) => i.kind === "unknown_anchor").length, 1);
});

test("flowsOf skips non-flow states in a mixed set", () => {
  assert.equal(flowsOf(all).length, 7);
});
