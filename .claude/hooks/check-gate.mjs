// PreToolUse hook: hard-deny a positive decision on a case whose blocking checks
// have not passed — defense in depth that mirrors the engine's own 422, but stops
// the agent before the call leaves the machine.
//
// Wired in .claude/hooks/hooks.json on the og_record_decision tool. Reads the
// PreToolUse event JSON on stdin and (for accepted / accepted_with_exceptions)
// fetches the case to confirm checksPassed. Env OPEN_GATES_URL (default
// http://localhost:3000) points at the running queue server.

import { readFileSync } from "node:fs";

const allow = () => process.exit(0);
const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
  );
  process.exit(0);
};

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  allow(); // can't parse -> don't block; the engine still enforces the rule
}

const { caseId, outcome } = input.tool_input ?? {};
const positive = outcome === "accepted" || outcome === "accepted_with_exceptions";
if (!positive || !caseId) allow();

const base = process.env.OPEN_GATES_URL ?? "http://localhost:3000";
try {
  const res = await fetch(`${base}/queue/${caseId}`);
  if (!res.ok) allow(); // server unreachable -> let the engine be the backstop
  const item = await res.json();
  if (item?.state?.checksPassed === false) {
    deny(`blocking checks have not passed on case ${caseId}; cannot ${outcome}. Return it for rework instead.`);
  }
} catch {
  allow();
}
allow();
