// Public API for the Open Gates reference engine.

import type {
  DecisionRecordedEvent,
  GateDefinition,
  GateState,
  Scenario,
} from "./types.ts";
import { computeAmount } from "./consequences.ts";

export * from "./types.ts";
export { runChecks, checksPassed, severityOf } from "./checks.ts";
export { fireConsequences, computeAmount } from "./consequences.ts";
export { fold, apply, initialState } from "./fold.ts";

/** Parse a plain object into a GateDefinition (no validation beyond typing). */
export function loadGate(obj: unknown): GateDefinition {
  return obj as GateDefinition;
}

export function loadScenario(obj: unknown): Scenario {
  return obj as Scenario;
}

/**
 * The automation path: once enough cases have been decided the same way, a
 * policy can let the gate decide itself. Returns the decision event a policy
 * would record, or null when a human is still required.
 */
export function autodecide(
  gate: GateDefinition,
  state: GateState,
  now: string = new Date().toISOString(),
): DecisionRecordedEvent | null {
  if (state.decision) return null;
  if (!state.claim) return null;
  const policy = gate.policy?.autoAcceptWhen;
  if (!policy?.checksPass) return null;
  if (!state.checksPassed) return null;
  const amount = computeAmount(gate, state, "accepted");
  if (policy.maxAmount !== undefined && amount > policy.maxAmount) return null;
  return {
    type: "decision.recorded",
    at: now,
    actor: "system:auto",
    reviewerRole: gate.reviewer.role,
    outcome: "accepted",
    note: `auto-accepted by policy (amount=${amount})`,
  };
}
