// Tiny CLI: fold a scenario against a gate and print the resulting state.
//
//   node src/cli.ts <gate.json> <scenario.json>

import { readFileSync } from "node:fs";
import { fold, loadGate, loadScenario } from "./index.ts";

const [gatePath, scenarioPath] = process.argv.slice(2);

if (!gatePath || !scenarioPath) {
  console.error("usage: node src/cli.ts <gate.json> <scenario.json>");
  process.exit(1);
}

const gate = loadGate(JSON.parse(readFileSync(gatePath, "utf8")));
const scenario = loadScenario(JSON.parse(readFileSync(scenarioPath, "utf8")));

if (scenario.gate && scenario.gate !== gate.id) {
  console.error(
    `! scenario targets gate "${scenario.gate}" but "${gate.id}" was provided`,
  );
}

const state = fold(gate, scenario.events);
console.log(JSON.stringify(state, null, 2));
