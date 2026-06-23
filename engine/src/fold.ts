// The fold engine.
//
// A gate case is an ordered, append-only log of events. `fold` reduces that log
// into a single state: the current status, the verification result, the decision
// and who owns it, the effects it fired, and a labelled dataset record.
//
//   claim -> evidence -> checks -> decision -> effects -> dataset label
//
// Determinism contract (enforced by test/fold.test.ts):
//   - pure:        fold(g, ev) deepEqual fold(g, ev)
//   - idempotent:  a redelivered event (same id) is a no-op
//   - replayable:  fold reads no Date.now(), Math.random(), or process.env
// Every timestamp in the state comes from an event's `at`, never the wall clock.

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
    seq: 0,
    seenIds: [],
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
export function apply(gate: GateDefinition, state: GateState, ev: GateEvent): GateState {
  if (ev.id === undefined || ev.seq === undefined) {
    throw new Error(
      `event is missing id/seq; load it through loadScenario()/normalizeLog() first (type=${ev.type})`,
    );
  }
  // Idempotent replay: an event already folded is a no-op (at-least-once safe).
  if (state.seenIds.includes(ev.id)) return state;
  // Optimistic ordering: the log must be gap-free.
  if (ev.seq !== state.seq + 1) {
    throw new Error(`out-of-order event: expected seq ${state.seq + 1}, got ${ev.seq} (id=${ev.id})`);
  }

  const next: GateState = {
    ...state,
    seq: ev.seq,
    seenIds: [...state.seenIds, ev.id],
    evidence: [...state.evidence],
    checks: [...state.checks],
    consequences: [...state.consequences],
    log: [...state.log],
  };

  if (ev.type === "decision.recorded") return applyDecision(gate, next, ev);

  if (ev.type === "claim.submitted") {
    next.claim = ev.claim;
    next.status = "submitted";
    if (!next.submittedAt) next.submittedAt = ev.at;
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

  const positive = ev.outcome === "accepted" || ev.outcome === "accepted_with_exceptions";

  // A claim cannot be accepted while blocking checks are unmet.
  if (positive && !next.checksPassed) {
    next.log.push(`${ev.at} ! "${ev.outcome}" blocked: blocking checks have not passed`);
    next.status = "under_review";
    return next;
  }

  next.decision = {
    outcome: ev.outcome,
    by: ev.actor,
    role: ev.reviewerRole,
    at: ev.at,
    acceptedValues: ev.acceptedValues,
    note: ev.note,
  };
  next.status = ev.outcome;
  next.decidedAt = ev.at;
  if (next.submittedAt) {
    const days = (Date.parse(ev.at) - Date.parse(next.submittedAt)) / 86_400_000;
    next.cycleDays = Math.round(days * 1000) / 1000;
  }
  if (positive) {
    next.responsibility = { acceptedBy: ev.actor, role: ev.reviewerRole, at: ev.at };
  }

  const { effects, label } = fireConsequences(gate, next, ev.outcome, ev.id, ev.at);
  next.consequences = effects;
  next.datasetLabel = label;
  next.log.push(`${ev.at} ${ev.actor} (${ev.reviewerRole}) recorded "${ev.outcome}"`);
  return next;
}

/** Fold an entire event log into a single gate state. */
export function fold(gate: GateDefinition, events: GateEvent[]): GateState {
  return events.reduce((s, e) => apply(gate, s, e), initialState(gate));
}
