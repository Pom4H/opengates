// Consequences: what an accepted (or rejected) fact releases — money, the right
// to proceed, assigned risk, and a labelled dataset record.
//
// Money is paid on the ACCEPTED quantity, never the claimed one. Amounts are
// computed in integer minor units (cents) to avoid float drift, then surfaced as
// 2-decimal majors. Each fired effect carries a stable `effectId` so external
// delivery (payment, webhook) is exactly-once on replay.

import { createHash } from "node:crypto";
import type {
  Consequence,
  CrossCheck,
  DatasetLabelRecord,
  FiredEffect,
  GateDefinition,
  GateState,
  MoneyConsequence,
  Outcome,
} from "./types.ts";

const cents = (major: number): number => Math.round(major * 100);
const major = (c: number): number => Math.round(c) / 100;

function effectId(decisionEventId: string, ruleId: string): string {
  return createHash("sha256").update(`${decisionEventId}:${ruleId}`).digest("hex").slice(0, 16);
}

// Resolve the quantity to pay on: the reviewer-accepted value, else the surveyed
// reference (from the cross_check that guards this field), else the claim.
function quantityToPay(
  gate: GateDefinition,
  state: GateState,
  field: string,
): { qty: number | undefined; source: "accepted" | "surveyed" | "claimed" | "none" } {
  const accepted = state.decision?.acceptedValues?.[field];
  if (typeof accepted === "number") return { qty: accepted, source: "accepted" };

  const cc = gate.checks.find(
    (c): c is CrossCheck => c.rule === "cross_check" && c.claimField === field,
  );
  if (cc) {
    const ev = state.evidence.find((e) => e.kind === cc.evidenceKind);
    const surveyed = ev?.values?.[cc.evidenceField];
    if (typeof surveyed === "number") return { qty: surveyed, source: "surveyed" };
  }

  const claimed = state.claim?.values?.[field];
  if (typeof claimed === "number") return { qty: claimed, source: "claimed" };
  return { qty: undefined, source: "none" };
}

interface MoneyBreakdown {
  basis: string;
  currency: string;
  quantity?: number;
  unitPrice?: number;
  quantitySource?: string;
  gross: number;
  retentionPct?: number;
  retention: number;
  net: number;
  vatRate?: number;
  vat?: number;
  paymentTermsDays?: number;
  estimateLine?: string;
  contractRef?: string;
}

function computeMoney(c: MoneyConsequence, gate: GateDefinition, state: GateState): MoneyBreakdown {
  if (typeof c.amount === "number") {
    const grossC = cents(c.amount);
    const retC = c.retentionPct ? Math.round(grossC * c.retentionPct) : 0;
    const netC = grossC - retC;
    return {
      basis: "fixed",
      currency: c.currency,
      gross: major(grossC),
      retentionPct: c.retentionPct,
      retention: major(retC),
      net: major(netC),
      vatRate: c.vatRate,
      vat: c.vatRate ? major(Math.round(netC * c.vatRate)) : undefined,
      paymentTermsDays: c.paymentTermsDays,
      estimateLine: c.estimateLine,
      contractRef: c.contractRef,
    };
  }

  if (c.quantityField && typeof c.unitPrice === "number") {
    const { qty, source } = quantityToPay(gate, state, c.quantityField);
    if (qty !== undefined) {
      const grossC = cents(qty * c.unitPrice);
      let retC = c.retentionPct ? Math.round(grossC * c.retentionPct) : 0;
      if (c.retentionCap !== undefined) retC = Math.min(retC, cents(c.retentionCap));
      const netC = grossC - retC;
      const vatC = c.vatRate ? Math.round(netC * c.vatRate) : undefined;
      return {
        basis: c.basis ?? "accepted_quantity",
        currency: c.currency,
        quantity: qty,
        unitPrice: c.unitPrice,
        quantitySource: source,
        gross: major(grossC),
        retentionPct: c.retentionPct,
        retention: major(retC),
        net: major(netC),
        vatRate: c.vatRate,
        vat: vatC === undefined ? undefined : major(vatC),
        paymentTermsDays: c.paymentTermsDays,
        estimateLine: c.estimateLine,
        contractRef: c.contractRef,
      };
    }
  }

  return {
    basis: c.basis ?? "accepted_quantity",
    currency: c.currency,
    gross: 0,
    retention: 0,
    net: 0,
    paymentTermsDays: c.paymentTermsDays,
    estimateLine: c.estimateLine,
    contractRef: c.contractRef,
  };
}

/** Net certified value a money consequence would release for an outcome. */
function netOf(c: MoneyConsequence, gate: GateDefinition, state: GateState): number {
  return computeMoney(c, gate, state).net;
}

/** Total net certified value across money consequences firing for an outcome. */
export function computeAmount(gate: GateDefinition, state: GateState, outcome: Outcome): number {
  let total = 0;
  for (const c of gate.consequences) {
    if (c.effect === "money" && c.on.includes(outcome)) total += netOf(c, gate, state);
  }
  return total;
}

function buildLabel(
  gate: GateDefinition,
  state: GateState,
  outcome: Outcome,
  at: string,
  dataset: string,
): DatasetLabelRecord {
  const checks: Record<string, string> = {};
  for (const r of state.checks) checks[r.id] = r.outcome;
  const accepted = state.decision?.acceptedValues ?? {};
  return {
    dataset,
    gate: gate.id,
    claim_type: state.claim?.type ?? "",
    features: {
      claimed: state.claim?.values ?? {},
      accepted,
      evidence_kinds: state.evidence.map((e) => e.kind),
      checks,
    },
    label: outcome,
    decided_by_role: gate.reviewer.role,
    at,
  };
}

/** Derive the effects a decision fires. Pure; effectIds are stable on replay. */
export function fireConsequences(
  gate: GateDefinition,
  state: GateState,
  outcome: Outcome,
  decisionEventId: string,
  at: string,
): { effects: FiredEffect[]; label?: DatasetLabelRecord } {
  const effects: FiredEffect[] = [];
  let label: DatasetLabelRecord | undefined;

  for (const c of gate.consequences as Consequence[]) {
    if (!c.on.includes(outcome)) continue;
    const id = effectId(decisionEventId, c.id);
    switch (c.effect) {
      case "money":
        effects.push({ effectId: id, ruleId: c.id, effect: "money", payload: { ...computeMoney(c, gate, state), description: c.description } });
        break;
      case "right_to_proceed":
        effects.push({ effectId: id, ruleId: c.id, effect: "right_to_proceed", payload: { unlocks: c.unlocks, description: c.description } });
        break;
      case "risk":
        effects.push({ effectId: id, ruleId: c.id, effect: "risk", payload: { assignedTo: c.assignedTo, description: c.description } });
        break;
      case "dataset_label": {
        label = buildLabel(gate, state, outcome, at, c.dataset);
        effects.push({ effectId: id, ruleId: c.id, effect: "dataset_label", payload: { dataset: c.dataset, record: label } });
        break;
      }
    }
  }
  return { effects, label };
}
