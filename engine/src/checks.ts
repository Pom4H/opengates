// Deterministic check evaluation: given a claim and the evidence gathered so
// far, decide whether the gate's verification rules pass.

import type {
  CheckDefinition,
  CheckResult,
  ClaimInstance,
  EvidenceInstance,
  GateDefinition,
  Scalar,
  Severity,
} from "./types.ts";

function asNumber(v: Scalar | undefined): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function isPresent(v: Scalar | undefined): boolean {
  return v !== undefined && v !== null && v !== "";
}

/** Evaluate every check against the current claim/evidence snapshot. */
export function runChecks(
  gate: GateDefinition,
  claim: ClaimInstance | undefined,
  evidence: EvidenceInstance[],
): CheckResult[] {
  return gate.checks.map((c) => evalCheck(c, claim, evidence));
}

function evalCheck(
  c: CheckDefinition,
  claim: ClaimInstance | undefined,
  evidence: EvidenceInstance[],
): CheckResult {
  switch (c.rule) {
    case "required_evidence": {
      const have = new Set(evidence.map((e) => e.kind));
      const missing = c.kinds.filter((k) => !have.has(k));
      return missing.length === 0
        ? { id: c.id, rule: c.rule, outcome: "pass" }
        : {
            id: c.id,
            rule: c.rule,
            outcome: "fail",
            detail: `missing evidence: ${missing.join(", ")}`,
          };
    }
    case "field_present": {
      const v = claim?.values?.[c.field];
      return isPresent(v)
        ? { id: c.id, rule: c.rule, outcome: "pass" }
        : {
            id: c.id,
            rule: c.rule,
            outcome: "fail",
            detail: `claim field "${c.field}" is missing`,
          };
    }
    case "field_range": {
      const v = asNumber(claim?.values?.[c.field]);
      if (v === undefined) {
        return {
          id: c.id,
          rule: c.rule,
          outcome: "skipped",
          detail: `field "${c.field}" is not a number yet`,
        };
      }
      const okMin = c.min === undefined || v >= c.min;
      const okMax = c.max === undefined || v <= c.max;
      return okMin && okMax
        ? { id: c.id, rule: c.rule, outcome: "pass" }
        : {
            id: c.id,
            rule: c.rule,
            outcome: "fail",
            detail: `${c.field}=${v} outside [${c.min ?? "-inf"}, ${c.max ?? "inf"}]`,
          };
    }
    case "cross_check": {
      const claimed = asNumber(claim?.values?.[c.claimField]);
      const ev = evidence.find((e) => e.kind === c.evidenceKind);
      const measured = asNumber(ev?.values?.[c.evidenceField]);
      if (claimed === undefined || measured === undefined) {
        return {
          id: c.id,
          rule: c.rule,
          outcome: "skipped",
          detail: "claim or evidence value not available yet",
        };
      }
      const base = Math.max(Math.abs(claimed), 1e-9);
      const delta = Math.abs(claimed - measured) / base;
      const pct = (delta * 100).toFixed(1);
      const tol = (c.tolerance * 100).toFixed(1);
      return delta <= c.tolerance
        ? {
            id: c.id,
            rule: c.rule,
            outcome: "pass",
            detail: `delta=${pct}% <= ${tol}%`,
          }
        : {
            id: c.id,
            rule: c.rule,
            outcome: "fail",
            detail: `delta=${pct}% > ${tol}% (claim ${claimed} vs ${c.evidenceKind} ${measured})`,
          };
    }
  }
  // Unknown rule — treat as a non-blocking skip rather than crashing the fold.
  return { id: "unknown", rule: "unknown", outcome: "skipped" };
}

export function severityOf(gate: GateDefinition, id: string): Severity {
  const c = gate.checks.find((x) => x.id === id);
  return c?.severity ?? "blocking";
}

/** A gate passes when every blocking check has passed. Warnings never block. */
export function checksPassed(gate: GateDefinition, results: CheckResult[]): boolean {
  return results.every(
    (r) => severityOf(gate, r.id) !== "blocking" || r.outcome === "pass",
  );
}
