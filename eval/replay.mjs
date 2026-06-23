// Replay a labelled dataset through the gate and score the automation policy.
//
// Turns "part of the decisions become automatable" from a claim into a number.
// Each dataset row is a labelled case: an event log (claim + evidence) plus the
// `label` a human recorded. We fold each case and ask autodecide() what the
// gate's policy WOULD do, then report:
//
//   coverage        fraction of cases the policy auto-decides
//   agreement       of those, fraction matching the human label
//   falseAcceptRate of those, fraction auto-accepted where the human did not
//
//   node eval/replay.mjs <gate.json> <dataset.jsonl>

import { readFileSync } from "node:fs";
import { autodecide, fold, loadGate, normalizeLog } from "../packages/engine/src/index.ts";

const [gatePath, dsPath] = process.argv.slice(2);
if (!gatePath || !dsPath) {
  console.error("usage: node eval/replay.mjs <gate.json> <dataset.jsonl>");
  process.exit(1);
}

const gate = loadGate(JSON.parse(readFileSync(gatePath, "utf8")));
const rows = readFileSync(dsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

let n = 0;
let autoFired = 0;
let agree = 0;
let falseAccept = 0;

for (const row of rows) {
  const state = fold(gate, normalizeLog("eval", row.events));
  const now = state.submittedAt ?? "1970-01-01T00:00:00Z";
  const auto = autodecide(gate, state, now);
  n++;
  if (auto) {
    autoFired++;
    if (auto.outcome === row.label) agree++;
    if (auto.outcome === "accepted" && row.label !== "accepted") falseAccept++;
  }
}

const coverage = autoFired / n;
const agreement = autoFired ? agree / autoFired : 1;
const falseAcceptRate = autoFired ? falseAccept / autoFired : 0;

const round = (x) => Math.round(x * 1000) / 1000;
console.log(JSON.stringify({ cases: n, autoFired, coverage: round(coverage), agreement: round(agreement), falseAcceptRate: round(falseAcceptRate) }, null, 2));

// Publishable automation bar: cover a meaningful slice with no wrong acceptances.
const pass = coverage >= 0.4 && agreement >= 0.99 && falseAcceptRate === 0;
console.log(pass ? "✓ automation bar met (coverage ≥ 0.40, agreement ≥ 0.99, falseAcceptRate = 0)" : "… below the automation bar — keep these cases under human review");
process.exit(0);
