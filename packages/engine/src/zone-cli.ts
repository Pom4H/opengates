// Fold works from one or more gates and show what is attached to each zone.
//
//   node packages/engine/src/zone-cli.ts --gate <gate.json> [--gate <gate2.json>] \
//        <scenario.json>... [--model <building.json>] [--json <out.json>]
//
// Each scenario is one work anchored (via its claim's zone field) to a zone;
// its `gate` field selects which loaded gate to fold it with. Prints a per-zone
// view — works, documents, acceptance rollup — plus any validation issues
// against the spatial model, and optionally writes the per-zone JSON (e.g.
// viz/model/attachments.json for the zone selector).

import { readFileSync, writeFileSync } from "node:fs";
import {
  attachmentsByZone,
  fold,
  lintZones,
  loadGate,
  loadScenario,
  type GateDefinition,
} from "./index.ts";

const gatePaths: string[] = [];
const scenarioPaths: string[] = [];
let jsonOut: string | undefined;
let modelPath: string | undefined;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--gate") gatePaths.push(args[++i]);
  else if (a === "--json") jsonOut = args[++i];
  else if (a === "--model") modelPath = args[++i];
  else scenarioPaths.push(a);
}

if (gatePaths.length === 0 || scenarioPaths.length === 0) {
  console.error(
    "usage: node packages/engine/src/zone-cli.ts --gate <gate.json>... <scenario.json>... [--model <building.json>] [--json <out.json>]",
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

const byZone = attachmentsByZone(states);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(byZone, null, 2) + "\n");
  console.error(`Wrote ${jsonOut} — ${Object.keys(byZone).length} zone(s)`);
}

for (const [zone, a] of Object.entries(byZone)) {
  const { accepted, total } = a.rollup;
  console.log(`\nzone ${zone} — ${accepted}/${total} works accepted`);
  for (const w of a.works) {
    const money = w.amount ? `  €${w.amount} ${w.currency ?? ""}`.trimEnd() : "";
    const label = w.title ? ` "${w.title}"` : "";
    console.log(`  • [${w.status}]${label}${money}`);
  }
  if (a.documents.length) {
    console.log(`  documents:`);
    for (const d of a.documents) console.log(`    - ${d.kind}: ${d.ref ?? "(no ref)"}`);
  }
}

if (modelPath) {
  const model = JSON.parse(readFileSync(modelPath, "utf8"));
  const issues = lintZones(states, model);
  console.log(
    issues.length
      ? `\nvalidation: ${issues.length} issue(s)`
      : `\nvalidation: ok — every zone exists in the model, no duplicate acceptances`,
  );
  for (const i of issues) console.log(`  ! [${i.kind}] ${i.detail}`);
}
