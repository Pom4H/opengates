// The fold engine.
//
// A gate case is an ordered log of events. `fold` reduces that log into a
// single state: the current status, the verification result, the decision and
// who is responsible for it, the economic consequences it released, and a
// labelled dataset record.
//
//   claim -> evidence -> checks -> decision -> consequences -> dataset label

import type {
  DecisionRecordedEvent,
  GateDefinition,
  GateEvent,
  GateState,
} from "./types.ts";
import { checksPassed, runChecks } from "./checks.ts";
import { fireConsequences } from "./consequences.ts";

export function initialState(gate: GateDefinition): GateState {
  return {
    gateId: gate.id,
    status: "draft",
    evidence: [],
    checks: [],
    checksPassed: false,
    consequences: [],
    log: [],
  };
}

function recompute(gate: GateDefinition, state: GateState): void {
  state.checks = runChecks(gate, state.claim, state.evidence);
  state.checksPassed = checksPassed(gate, state.checks);
}

/** Apply a single event, returning a new state (events are never mutated). */
export function apply(
  gate: GateDefinition,
  state: GateState,
  ev: GateEvent,
): GateState {
  const next: GateState = {
    ...state,
    evidence: [...state.evidence],
    checks: [...state.checks],
    consequences: [...state.consequences],
    log: [...state.log],
  };

  if (ev.type === "decision.recorded") {
    return applyDecision(gate, next, ev);
  }

  if (ev.type === "claim.submitted") {
    next.claim = ev.claim;
    next.status = "submitted";
    next.log.push(`${ev.at} ${ev.actor} submitted claim "${ev.claim.type}"`);
  } else if (ev.type === "evidence.attached") {
    next.evidence.push(ev.evidence);
    if (next.status === "draft") next.status = "submitted";
    next.log.push(`${ev.at} ${ev.actor} attached evidence "${ev.evidence.kind}"`);
  }

  recompute(gate, next);
  if (next.status === "submitted" && next.claim) next.status = "under_review";
  return next;
}

function applyDecision(
  gate: GateDefinition,
  next: GateState,
  ev: DecisionRecordedEvent,
): GateState {
  recompute(gate, next);

  // Responsibility is role-bound: only the gate's reviewer role may decide.
  if (ev.reviewerRole !== gate.reviewer.role) {
    next.log.push(
      `${ev.at} ! decision by role "${ev.reviewerRole}" ignored; gate requires "${gate.reviewer.role}"`,
    );
    return next;
  }

  const positive =
    ev.outcome === "accepted" || ev.outcome === "accepted_with_exceptions";

  // A claim cannot be accepted while blocking checks are unmet.
  if (positive && !next.checksPassed) {
    next.log.push(
      `${ev.at} ! "${ev.outcome}" blocked: blocking checks have not passed`,
    );
    next.status = "under_review";
    return next;
  }

  next.decision = {
    outcome: ev.outcome,
    by: ev.actor,
    role: ev.reviewerRole,
    at: ev.at,
    note: ev.note,
  };
  next.status = ev.outcome;
  if (positive) {
    next.responsibility = { acceptedBy: ev.actor, role: ev.reviewerRole, at: ev.at };
  }

  const { effects, label } = fireConsequences(gate, next, ev.outcome, ev.at);
  next.consequences = effects;
  next.datasetLabel = label;
  next.log.push(
    `${ev.at} ${ev.actor} (${ev.reviewerRole}) recorded "${ev.outcome}"`,
  );
  return next;
}

/** Fold an entire event log into a single gate state. */
export function fold(gate: GateDefinition, events: GateEvent[]): GateState {
  return events.reduce((s, e) => apply(gate, s, e), initialState(gate));
}
