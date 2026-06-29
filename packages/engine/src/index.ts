// Public API for the Open Gates reference engine.

import type {
  AuthoredEvent,
  DecisionRecordedEvent,
  GateDefinition,
  GateEvent,
  GateState,
  Scenario,
} from "./types.ts";
import { computeAmount } from "./consequences.ts";

export * from "./types.ts";
export { runChecks, checksPassed, severityOf } from "./checks.ts";
export { fireConsequences, computeAmount } from "./consequences.ts";
export { fold, apply, initialState } from "./fold.ts";
export { createOutbox, pending, deliver } from "./effects.ts";
export { labelOf, collectLabels, toJsonl } from "./dataset.ts";
export { zoneOf, indexByZone, attachmentsByZone, lintZones, knownZoneIds } from "./zones.ts";
export type { ZoneWork, ZoneDocument, ZoneAttachments, SpatialModel, ZoneIssue } from "./zones.ts";
export {
  flowOf,
  flowsOf,
  flowGraph,
  flowGraphJSON,
  resourceLedger,
  ledgerJSON,
  lintFlows,
} from "./flows.ts";
export type {
  Anchor,
  AnchorKind,
  ResourceKind,
  Flow,
  FlowKind,
  OperationalModel,
  FlowGraph,
  ResourceLine,
  FlowIssue,
  FlowIssueKind,
} from "./flows.ts";

/** Parse a plain object into a GateDefinition (typing only; no validation). */
export function loadGate(obj: unknown): GateDefinition {
  return obj as GateDefinition;
}

/**
 * Give authored events stable ids and a gap-free sequence. Hand-written scenarios
 * omit `id`/`seq` for readability; this fills them deterministically (no random,
 * no clock) so fold stays replayable.
 */
export function normalizeLog(caseId: string, events: AuthoredEvent[]): GateEvent[] {
  return events.map((e, i) => {
    const seq = e.seq ?? i + 1;
    return { ...e, seq, id: e.id ?? `${caseId}#${seq}` } as GateEvent;
  });
}

/** Parse a scenario file and normalize its event log. */
export function loadScenario(obj: unknown): Scenario {
  const s = obj as { gate: string; events: AuthoredEvent[] };
  return { gate: s.gate, events: normalizeLog(s.gate, s.events ?? []) };
}

/**
 * The automation path: once enough cases decide the same way, a policy can let
 * the gate decide itself. Returns the decision event a policy would record, or
 * null when a human is still required.
 *
 * `now` is REQUIRED — pass the triggering event's timestamp — so replaying the
 * same log always yields the same auto-decision. The engine never reads the wall
 * clock.
 */
export function autodecide(
  gate: GateDefinition,
  state: GateState,
  now: string,
): DecisionRecordedEvent | null {
  if (state.decision || !state.claim) return null;
  const policy = gate.policy?.autoAcceptWhen;
  if (!policy?.checksPass || !state.checksPassed) return null;
  const amount = computeAmount(gate, state, "accepted");
  if (policy.maxAmount !== undefined && amount > policy.maxAmount) return null;
  return {
    id: `${state.gateId}#auto-${state.seq + 1}`,
    seq: state.seq + 1,
    type: "decision.recorded",
    at: now,
    actor: "system:auto",
    reviewerRole: gate.reviewer.role,
    outcome: "accepted",
    note: `auto-accepted by policy (net=${amount})`,
  };
}
