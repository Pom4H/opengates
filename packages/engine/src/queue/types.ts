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

import type { GateDefinition, GateEvent, GateState, Outcome } from "../types.ts";

export type QueueStatus = "pending" | "leased" | "decided";
export type Priority = "low" | "normal" | "high" | "critical";

export interface Lease {
  /** Opaque token the holder echoes back when deciding/releasing. */
  token: string;
  /**
   * Monotonic fencing token (Kleppmann). Increments on every (re)lease, so a
   * resurrected stale holder is rejected even if its token still looks valid.
   */
  fence: number;
  holder?: string;
  /** ISO time at which the lease expires and the item returns to pending. */
  until: string;
}

export interface Assignment {
  at: string;
  /** Who performed the delegation (required — a trace must have an author). */
  by: string;
  kind: "route" | "reassign" | "claim" | "release" | "escalate" | "return";
  inbox?: string;
  assignee?: string;
  fromInbox?: string;
  fromAssignee?: string;
  reason?: string;
}

export interface Inbox {
  name: string;
  description?: string;
  match?: { domain?: string; gateId?: string; reviewerRole?: string };
  createdAt: string;
}

export interface QueueItem {
  id: string;
  status: QueueStatus;
  gateId: string;
  gate: GateDefinition;
  events: GateEvent[];
  state: GateState;
  allowedDecisions: Outcome[];
  inbox?: string;
  assignee?: string;
  assignments: Assignment[];
  enqueuedAt: string;
  updatedAt: string;
  lease?: Lease;
  /** Highest fence ever issued for this case (fencing-token high-water mark). */
  maxFence?: number;
  // --- SLA (set at enqueue when the gate declares one) ---
  priority?: Priority;
  /** enqueuedAt + gate.sla.reviewWithinHours. */
  dueAt?: string;
  /** First time reap() observed now > dueAt while still undecided. */
  breachedAt?: string;
  notify?: string;
  decidedBy?: string;
  /** Idempotency key of the decision that closed this case (dedups retries). */
  decisionKey?: string;
  history: string[];
}

export interface QueueSnapshot {
  items: QueueItem[];
  inboxes: Inbox[];
}

export interface EnqueueInput {
  gate: GateDefinition;
  events?: GateEvent[];
  scenario?: { gate?: string; events: GateEvent[] };
  notify?: string;
  inbox?: string;
  assignee?: string;
  by?: string;
  reason?: string;
}

export interface AssignInput {
  inbox?: string;
  assignee?: string;
  by: string;
  reason?: string;
  kind?: Assignment["kind"];
}

export interface LeaseInput {
  holder?: string;
  inbox?: string;
  assignee?: string;
  role?: string;
  domain?: string;
  leaseSeconds?: number;
}

export interface DecisionInput {
  outcome: Outcome;
  reviewerRole: string;
  actor: string;
  /** Quantities the reviewer accepted (e.g. surveyed 117, not claimed 120). */
  acceptedValues?: Record<string, string | number | boolean>;
  note?: string;
  /** The lease token from lease(); REQUIRED while the case is leased. */
  leaseToken?: string;
  /** Dedup key: a retried decision with the same key returns the first result. */
  idempotencyKey?: string;
  /** Override the decision timestamp (tests / replays). */
  at?: string;
}

export interface DecideResult {
  item: QueueItem;
  state: GateState;
}

export interface InboxCounts {
  pending: number;
  leased: number;
  decided: number;
  breached: number;
  dueSoon: number;
  total: number;
}

export interface InboxSummary extends Inbox {
  counts: InboxCounts;
}
