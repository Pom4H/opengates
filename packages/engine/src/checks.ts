// Deterministic check evaluation.
//
// Given a claim and the evidence gathered so far, decide whether each of the
// gate's verification rules passes. Pure: same inputs -> same results.

import type {
  Check,
  CheckResult,
  CheckSeverity,
  ClaimValue,
  CrossCheck,
  EvidenceValue,
  GateDefinition,
  Scalar,
} from "./types.ts";

function asNumber(v: Scalar | undefined): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function asString(v: Scalar | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function isPresent(v: Scalar | undefined): boolean {
  return v !== undefined && v !== null && v !== "";
}

function sev(c: Check): CheckSeverity {
  return c.severity ?? "blocking";
}

/** Evaluate every check against the current claim/evidence snapshot. */
export function runChecks(
  gate: GateDefinition,
  claim: ClaimValue | undefined,
  evidence: EvidenceValue[],
): CheckResult[] {
  return gate.checks.map((c) => evalCheck(c, claim, evidence));
}

function evalCheck(
  c: Check,
  claim: ClaimValue | undefined,
  evidence: EvidenceValue[],
): CheckResult {
  const base = { id: c.id, rule: c.rule, severity: sev(c) } as const;

  switch (c.rule) {
    case "required_evidence": {
      const have = new Set(evidence.map((e) => e.kind));
      const missing = c.kinds.filter((k) => !have.has(k));
      return missing.length === 0
        ? { ...base, outcome: "pass", detail: `present: ${c.kinds.join(", ")}` }
        : { ...base, outcome: "fail", detail: `missing evidence: ${missing.join(", ")}` };
    }

    case "field_present": {
      const v = claim?.values?.[c.field];
      return isPresent(v)
        ? { ...base, outcome: "pass" }
        : { ...base, outcome: "fail", detail: `claim field "${c.field}" is missing` };
    }

    case "field_range": {
      const v = asNumber(claim?.values?.[c.field]);
      if (v === undefined)
        return { ...base, outcome: "skipped", detail: `field "${c.field}" is not a number yet` };
      const okMin = c.min === undefined || v >= c.min;
      const okMax = c.max === undefined || v <= c.max;
      return okMin && okMax
        ? { ...base, outcome: "pass", detail: `${c.field}=${v} in [${c.min ?? "-inf"}, ${c.max ?? "inf"}]` }
        : { ...base, outcome: "fail", detail: `${c.field}=${v} outside [${c.min ?? "-inf"}, ${c.max ?? "inf"}]` };
    }

    case "field_pattern": {
      const v = asString(claim?.values?.[c.field]);
      if (v === undefined)
        return { ...base, outcome: "skipped", detail: `field "${c.field}" is not present yet` };
      return new RegExp(c.pattern).test(v)
        ? { ...base, outcome: "pass", detail: `${c.field}="${v}" matches /${c.pattern}/` }
        : { ...base, outcome: "fail", detail: `${c.field}="${v}" does not match /${c.pattern}/` };
    }

    case "cross_check":
      return crossCheck(c, base, claim, evidence);

    case "date_window": {
      const v = asString(claim?.values?.[c.field]);
      if (v === undefined)
        return { ...base, outcome: "skipped", detail: `field "${c.field}" is not a date yet` };
      const t = Date.parse(v);
      if (Number.isNaN(t))
        return { ...base, outcome: "fail", detail: `"${c.field}"=${v} is not a valid date` };
      const okStart = !c.start || t >= Date.parse(c.start);
      const okEnd = !c.end || t <= Date.parse(c.end);
      return okStart && okEnd
        ? { ...base, outcome: "pass", detail: `${v} within [${c.start ?? "-inf"}, ${c.end ?? "inf"}]` }
        : { ...base, outcome: "fail", detail: `${v} outside [${c.start ?? "-inf"}, ${c.end ?? "inf"}]` };
    }
  }
}

// cross_check: error is measured against the REFERENCE (the trusted evidence
// value), per VIM §2.16. Acceptance limit = max(tolerance·|reference|, absolute).
// When the evidence carries expanded uncertainty U (GUM), the claim must also be
// within U of the reference (ISO/IEC 17025:2017 §7.8.6 simple acceptance).
function crossCheck(
  c: CrossCheck,
  base: { id: string; rule: "cross_check"; severity: CheckSeverity },
  claim: ClaimValue | undefined,
  evidence: EvidenceValue[],
): CheckResult {
  const claimed = asNumber(claim?.values?.[c.claimField]);
  const ev = evidence.find((e) => e.kind === c.evidenceKind);
  const reference = asNumber(ev?.values?.[c.evidenceField]);
  if (claimed === undefined || reference === undefined)
    return { ...base, outcome: "skipped", detail: "claim or reference value not available yet" };

  // Unit guard: the claim's unit must equal the evidence's unit.
  if (c.requireUnitMatch !== false && c.claimUnit) {
    const refUnit = asString(ev?.values?.[c.evidenceUnitField ?? "unit"]);
    if (refUnit && refUnit !== c.claimUnit)
      return { ...base, outcome: "fail", detail: `unit mismatch: claim ${c.claimUnit} vs evidence ${refUnit}` };
  }

  const absError = Math.abs(claimed - reference);
  const U = asNumber(ev?.values?.[c.uncertaintyField ?? "U"]) ?? 0;

  const limits: number[] = [];
  if (c.tolerance !== undefined) limits.push(c.tolerance * Math.abs(reference));
  if (c.absolute !== undefined) limits.push(c.absolute);
  const limit = limits.length ? Math.max(...limits) : 0;

  const relPct = ((absError / Math.max(Math.abs(reference), 1e-12)) * 100).toFixed(2);
  const limShow = Math.round(limit * 1e6) / 1e6; // avoid float-noise tails in the reviewer-facing detail
  const withinLimit = absError <= limit;
  const withinU = U === 0 ? true : absError <= U;

  if (withinLimit && withinU) {
    return {
      ...base,
      outcome: "pass",
      detail: `|claim−ref|=${absError} (${relPct}% of ref ${reference}), within limit ${limShow}${U ? ` and U=${U}` : ""}`,
    };
  }
  const breached = !withinLimit ? `limit ${limShow}` : `U=${U}`;
  return {
    ...base,
    outcome: "fail",
    detail: `|claim−ref|=${absError} (${relPct}% of ref ${reference}) exceeds ${breached} (claim ${claimed} vs ${c.evidenceKind} ${reference})`,
  };
}

/** A gate passes when every blocking check has passed. Warnings never block. */
export function checksPassed(_gate: GateDefinition, results: CheckResult[]): boolean {
  return results.every((r) => r.severity !== "blocking" || r.outcome === "pass");
}

export function severityOf(gate: GateDefinition, id: string): CheckSeverity {
  const c = gate.checks.find((x) => x.id === id);
  return c?.severity ?? "blocking";
}
