// Open Gates conformance runner.
//
// The standard's contract is data, not code: a gate definition + an event log
// MUST fold to the normative state in conformance/expected/<case>.json — on ANY
// engine, in ANY language. This runner is one checker (it uses the reference
// engine), but the golden files are the authority. A third-party implementation
// passes conformance by reproducing the same normative projection.
//
//   node conformance/run.mjs            # check the reference engine vs the goldens
//   node conformance/run.mjs --update   # regenerate the goldens (maintainers only)
//
// The NORMATIVE projection (what must match) is defined in conformance/README.md.
// Informative, implementation-specific fields — the human-readable `log`, event
// `seenIds`, `effectId` hashes, and echoed input timestamps — are excluded.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { fold, loadGate, loadScenario } from "../packages/engine/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const update = process.argv.includes("--update");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

// --- the normative projection ------------------------------------------------

function projectEffect(e) {
  const p = e.payload ?? {};
  switch (e.effect) {
    case "money":
      return { effect: "money", basis: p.basis ?? null, currency: p.currency ?? null, quantity: p.quantity ?? null, quantitySource: p.quantitySource ?? null, gross: p.gross ?? null, retention: p.retention ?? null, net: p.net ?? null, vat: p.vat ?? null };
    case "right_to_proceed":
      return { effect: "right_to_proceed", unlocks: p.unlocks ?? null };
    case "risk":
      return { effect: "risk", assignedTo: p.assignedTo ?? null };
    case "dataset_label":
      return { effect: "dataset_label", dataset: p.dataset ?? null };
    default:
      return { effect: e.effect };
  }
}

function project(state) {
  const dl = state.datasetLabel;
  return {
    status: state.status,
    checksPassed: state.checksPassed,
    checks: [...state.checks]
      .map((c) => ({ id: c.id, rule: c.rule, outcome: c.outcome, severity: c.severity }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    decision: state.decision ? { outcome: state.decision.outcome, role: state.decision.role, acceptedValues: state.decision.acceptedValues ?? null } : null,
    responsibility: state.responsibility ? { role: state.responsibility.role } : null,
    cycleDays: state.cycleDays ?? null,
    consequences: [...state.consequences].map(projectEffect).sort((a, b) => (stable(a) < stable(b) ? -1 : 1)),
    datasetLabel: dl ? { dataset: dl.dataset, label: dl.label, claim_type: dl.claim_type, decided_by_role: dl.decided_by_role, features: { claimed: dl.features.claimed, accepted: dl.features.accepted, evidence_kinds: dl.features.evidence_kinds, checks: dl.features.checks } } : null,
  };
}

// Stable stringify (recursively sorted keys) so goldens and diffs are canonical.
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
const pretty = (v) => JSON.stringify(JSON.parse(stable(v)), null, 2);

// --- run ---------------------------------------------------------------------

let pass = 0;
let fail = 0;
mkdirSync(join(here, "expected"), { recursive: true });

for (const c of manifest.cases) {
  const gate = loadGate(JSON.parse(readFileSync(join(root, c.gate), "utf8")));
  const scenario = loadScenario(JSON.parse(readFileSync(join(root, c.scenario), "utf8")));
  const got = project(fold(gate, scenario.events));
  const goldenPath = join(here, "expected", `${c.name}.json`);

  if (update) {
    writeFileSync(goldenPath, pretty(got) + "\n");
    console.log(`  ↻ ${c.name}`);
    continue;
  }

  let expected;
  try {
    expected = JSON.parse(readFileSync(goldenPath, "utf8"));
  } catch {
    console.log(`  ✗ ${c.name} — no golden (run --update)`);
    fail++;
    continue;
  }
  if (stable(got) === stable(expected)) {
    console.log(`  ✓ ${c.name}`);
    pass++;
  } else {
    console.log(`  ✗ ${c.name} — folded state differs from the golden`);
    console.log("    expected:", stable(expected).slice(0, 200));
    console.log("    got     :", stable(got).slice(0, 200));
    fail++;
  }
}

if (update) {
  console.log(`\nregenerated ${manifest.cases.length} golden(s).`);
  process.exit(0);
}
console.log(`\nconformance: ${pass} passed, ${fail} failed (of ${manifest.cases.length}).`);
process.exit(fail ? 1 : 0);
