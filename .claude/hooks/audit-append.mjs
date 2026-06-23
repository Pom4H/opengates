// PostToolUse hook: append every decision the agent records to a local,
// append-only audit log (.claude/decisions.jsonl). A second, agent-side trail
// next to the engine's own event log — useful for reviewing what an autonomous
// reviewer did across a session.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const entry = {
  at: new Date().toISOString(),
  tool: input.tool_name,
  caseId: input.tool_input?.id,
  outcome: input.tool_input?.outcome,
  note: input.tool_input?.note,
};

const path = ".claude/decisions.jsonl";
try {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n");
} catch {
  // best-effort; never block the agent on an audit write
}
process.exit(0);
