// Review-queue types.
//
// The queue holds Open Gates *cases* awaiting a reviewer's decision. An item is
// a gate definition plus the event log so far (claim + evidence), folded into a
// snapshot state. A reviewer — Claude, another harness, or a human — leases an
// item, inspects it, and records a decision; the engine folds that in.
//
// Cases are distributed to *inboxes* (named buckets, e.g. per role/team) and/or
// to specific *participants*. Every such delegation is recorded as an immutable
// entry in the item's append-only `assignments` trail — a delegation, once made,
// can never be erased, only superseded by a later entry.

import type {
  DecisionOutcome,
  GateDefinition,
  GateEvent,
  GateState,
} from "../types.ts";

/** Queue-level lifecycle, distinct from the gate's own GateStatus. */
export type QueueStatus = "pending" | "leased" | "decided";

export interface Lease {
  /** Opaque token the holder echoes back when deciding/releasing. */
  token: string;
  /** Who holds the lease (a role or harness id), if given. */
  holder?: string;
  /** ISO time at which the lease expires and the item returns to pending. */
  until: string;
}

/**
 * One immutable entry in a case's delegation trail. Appended whenever the case
 * is routed, reassigned, claimed, released or escalated. Never edited.
 */
export interface Assignment {
  at: string;
  /** Who performed the delegation (required — a trace must have an author). */
  by: string;
  kind: "route" | "reassign" | "claim" | "release" | "escalate" | "return";
  /** Destination inbox (for route / reassign / escalate). */
  inbox?: string;
  /** Destination participant (for claim / direct assignment). */
  assignee?: string;
  /** Prior inbox/assignee, captured so the trail is self-describing. */
  fromInbox?: string;
  fromAssignee?: string;
  reason?: string;
}

/** A named destination cases can be routed to. */
export interface Inbox {
  name: string;
  description?: string;
  /** Optional rule: cases matching this are auto-routed here on enqueue. */
  match?: { domain?: string; gateId?: string; reviewerRole?: string };
  createdAt: string;
}

export interface QueueItem {
  id: string;
  status: QueueStatus;
  gateId: string;
  gate: GateDefinition;
  /** The append-only case log (claim + evidence + any decision). */
  events: GateEvent[];
  /** Folded snapshot: status, check results, consequences, dataset label. */
  state: GateState;
  /** Decision outcomes this gate allows (mirror of gate.decisions). */
  allowedDecisions: DecisionOutcome[];
  /** Current inbox, derived from the latest assignment (undefined = unassigned). */
  inbox?: string;
  /** Current participant, derived from the latest assignment. */
  assignee?: string;
  /** Append-only delegation trail. The authoritative "trace". Never edited. */
  assignments: Assignment[];
  enqueuedAt: string;
  updatedAt: string;
  lease?: Lease;
  /** Per-item webhook URL fired on enqueue/assign/decide (best-effort push). */
  notify?: string;
  /** Actor of the final decision (a human, a harness, or "system:auto"). */
  decidedBy?: string;
  /** Human-readable queue audit trail. */
  history: string[];
}

/** The persisted snapshot: the queue is one document of items + inboxes. */
export interface QueueSnapshot {
  items: QueueItem[];
  inboxes: Inbox[];
}

/** Push a case onto the queue. Accepts events directly or a scenario wrapper. */
export interface EnqueueInput {
  gate: GateDefinition;
  events?: GateEvent[];
  scenario?: { gate?: string; events: GateEvent[] };
  notify?: string;
  /** Route the new case straight to this inbox (else routing rules apply). */
  inbox?: string;
  /** Assign the new case straight to this participant. */
  assignee?: string;
  /** Who routed it (recorded in the trail; defaults to "system:router"). */
  by?: string;
  reason?: string;
}

/** Delegate a case to an inbox and/or a participant, leaving a trace. */
export interface AssignInput {
  inbox?: string;
  assignee?: string;
  /** Who is delegating. Required — a delegation trace must name its author. */
  by: string;
  reason?: string;
  /** Override the recorded kind (default inferred: route vs reassign). */
  kind?: Assignment["kind"];
}

/** Pull the next case to review. All fields optional; absent = no filter. */
export interface LeaseInput {
  /** Identifier of the reviewer taking the item (becomes the assignee). */
  holder?: string;
  /** Only lease items in this inbox. */
  inbox?: string;
  /** Only lease items assigned to this participant (or unassigned). */
  assignee?: string;
  /** Only lease items whose gate.reviewer.role matches this. */
  role?: string;
  /** Only lease items in this gate domain. */
  domain?: string;
  /** Override the queue's default lease (visibility) duration. */
  leaseSeconds?: number;
}

/** Record a reviewer's decision on a leased (or pending) item. */
export interface DecisionInput {
  outcome: DecisionOutcome;
  reviewerRole: string;
  actor: string;
  note?: string;
  /** The lease token from lease(); required if the item is currently leased. */
  leaseToken?: string;
  /** Override the decision timestamp (tests / replays). */
  at?: string;
}

export interface DecideResult {
  item: QueueItem;
  state: GateState;
}

export interface InboxSummary extends Inbox {
  counts: { pending: number; leased: number; decided: number; total: number };
}
