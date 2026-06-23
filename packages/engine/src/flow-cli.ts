// Fold flow cases and show the resource graph, the per-resource ledger, and any
// cross-case issues — and optionally write viz/model/flows.json + ledger.json
// for the flow viewer.
//
//   node packages/engine/src/flow-cli.ts --gate <gate.json>... <scenario.json>... \
//        [--model <graph.json>] [--flows <flows.json>] [--ledger <ledger.json>]
//
// Mirrors zone-cli.ts: each scenario's `gate` field selects which loaded gate to
// fold it with. A scenario whose claim carries from/to (or zone+system) becomes
// an edge; its acceptance state colours the edge and feeds the ledger.

import { readFileSync, writeFileSync } from "node:fs";
import {
  fold,
  flowGraphJSON,
  ledgerJSON,
  lintFlows,
  loadGate,
  loadScenario,
  type GateDefinition,
  type OperationalModel,
} from "./index.ts";

const gatePaths: string[] = [];
const scenarioPaths: string[] = [];
let modelPath: string | undefined;
let flowsOut: string | undefined;
let ledgerOut: string | undefined;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--gate") gatePaths.push(args[++i]);
  else if (a === "--model") modelPath = args[++i];
  else if (a === "--flows") flowsOut = args[++i];
  else if (a === "--ledger") ledgerOut = args[++i];
  else scenarioPaths.push(a);
}

if (gatePaths.length === 0 || scenarioPaths.length === 0) {
  console.error(
    "usage: node packages/engine/src/flow-cli.ts --gate <gate.json>... <scenario.json>... [--model <graph.json>] [--flows <out.json>] [--ledger <out.json>]",
  );
  process.exit(1);
}

const gates = new Map<string, GateDefinition>();
for (const p of gatePaths) {
  const g = loadGate(JSON.parse(readFileSync(p, "utf8")));
  gates.set(g.id, g);
}

const only = gates.size === 1 ? [...gates.values()][0] : undefined;
const states = scenarioPaths.map((p) => {
  const scenario = loadScenario(JSON.parse(readFileSync(p, "utf8")));
  const gate = (scenario.gate && gates.get(scenario.gate)) || only;
  if (!gate) {
    console.error(`! no gate loaded for scenario "${p}" (gate: ${scenario.gate})`);
    process.exit(1);
  }
  return fold(gate, scenario.events);
});

const model: OperationalModel | undefined = modelPath
  ? JSON.parse(readFileSync(modelPath, "utf8"))
  : undefined;

const graph = flowGraphJSON(states, model);
const ledger = ledgerJSON(states, model);

if (flowsOut) {
  writeFileSync(flowsOut, JSON.stringify(graph, null, 2) + "\n");
  console.error(`Wrote ${flowsOut} — ${graph.nodes.length} node(s), ${graph.edges.length} edge(s)`);
}
if (ledgerOut) {
  writeFileSync(ledgerOut, JSON.stringify(ledger, null, 2) + "\n");
  console.error(`Wrote ${ledgerOut} — ${Object.keys(ledger).length} resource(s)`);
}

console.log(`\nflows — ${graph.edges.length} edge(s) across ${graph.nodes.length} anchor(s)`);
for (const e of graph.edges) {
  const q = e.qty !== undefined ? ` ${e.qty}${e.unit ? " " + e.unit : ""}` : "";
  const money = e.amount ? `  €${e.amount} ${e.currency ?? ""}`.trimEnd() : "";
  console.log(`  • [${e.status}] ${e.kind}${q}: ${e.from} → ${e.to}${money}`);
}

console.log(`\nledger — ${Object.keys(ledger).length} resource(s)`);
for (const l of Object.values(ledger)) {
  const u = l.unit ? " " + l.unit : "";
  console.log(`  • ${l.resource}: in ${l.in}${u}, out ${l.out}${u}, remaining ${l.remaining}${u}`);
}

const issues = lintFlows(states, model);
console.log(
  issues.length
    ? `\nvalidation: ${issues.length} issue(s)`
    : `\nvalidation: ok — every anchor is in the model, no resource over-consumed`,
);
for (const i of issues) console.log(`  ! [${i.kind}] ${i.detail}`);
