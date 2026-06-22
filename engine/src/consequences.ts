// Consequences: what an accepted (or rejected) fact releases — money, the
// right to proceed, assigned risk, and a labelled dataset record.

import type {
  ConsequenceEffect,
  DatasetLabel,
  DecisionOutcome,
  GateDefinition,
  GateState,
  MoneyConsequence,
} from "./types.ts";

function amountOf(c: MoneyConsequence, state: GateState): number {
  if (typeof c.amount === "number") return c.amount;
  if (c.quantityField && typeof c.unitPrice === "number") {
    const q = state.claim?.values?.[c.quantityField];
    if (typeof q === "number") return q * c.unitPrice;
  }
  return 0;
}

/** Sum of money consequences that would fire for a given outcome. */
export function computeAmount(
  gate: GateDefinition,
  state: GateState,
  outcome: DecisionOutcome,
): number {
  let total = 0;
  for (const c of gate.consequences) {
    if (c.effect === "money" && c.on.includes(outcome)) total += amountOf(c, state);
  }
  return total;
}

export function fireConsequences(
  gate: GateDefinition,
  state: GateState,
  outcome: DecisionOutcome,
  at: string,
): { effects: ConsequenceEffect[]; label?: DatasetLabel } {
  const effects: ConsequenceEffect[] = [];
  for (const c of gate.consequences) {
    if (!c.on.includes(outcome)) continue;
    switch (c.effect) {
      case "money":
        effects.push({
          id: c.id,
          effect: "money",
          amount: amountOf(c, state),
          currency: c.currency,
          description: c.description,
        });
        break;
      case "right_to_proceed":
        effects.push({
          id: c.id,
          effect: "right_to_proceed",
          unlocks: c.unlocks,
          description: c.description,
        });
        break;
      case "risk":
        effects.push({
          id: c.id,
          effect: "risk",
          assignedTo: c.assignedTo,
          description: c.description,
        });
        break;
      case "dataset_label":
        effects.push({
          id: c.id,
          effect: "dataset_label",
          dataset: c.dataset,
          description: c.description,
        });
        break;
    }
  }

  const labelRule = gate.consequences.find(
    (c) => c.effect === "dataset_label" && c.on.includes(outcome),
  );
  const label =
    labelRule && labelRule.effect === "dataset_label"
      ? buildLabel(gate, state, outcome, at, labelRule.dataset)
      : undefined;

  if (label) {
    for (const e of effects) if (e.effect === "dataset_label") e.label = label;
  }
  return { effects, label };
}

function buildLabel(
  gate: GateDefinition,
  state: GateState,
  outcome: DecisionOutcome,
  at: string,
  dataset: string,
): DatasetLabel {
  const checks: Record<string, string> = {};
  for (const r of state.checks) checks[r.id] = r.outcome;
  return {
    dataset,
    gate: gate.id,
    claim_type: state.claim?.type,
    features: {
      ...(state.claim?.values ?? {}),
      evidence_kinds: state.evidence.map((e) => e.kind),
      checks,
    },
    label: outcome,
    decided_by_role: gate.reviewer.role,
    at,
  };
}
