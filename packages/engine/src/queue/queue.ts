// The review queue.
//
// A small, dependency-free primitive that turns the fold engine into a
// push & pull review workflow with delegation and SLAs:
//
//   enqueue  (push)   -> a case awaits review, routed to an inbox if a rule fits
//   assign   (route)  -> delegate a case to an inbox and/or a participant
//   lease    (pull)   -> a reviewer takes the next case (breached/priority first),
//                        under a fencing token with a timeout
//   decide            -> the reviewer's outcome is folded in; effects fire once
//   release           -> hand a leased case back without deciding
//
// Reviewers are pluggable: a Claude skill, another agent harness, or a human
// hitting the HTTP API. The queue does not care who decides — only that the
// gate's reviewer role and its blocking checks are respected (enforced by fold),
// and that a leased case is decided under the current fence (enforced here).
//
// DELEGATION LEAVES A TRACE. Every route/reassign/claim/release/escalate appends
// an immutable entry to the item's `assignments` trail; the current inbox and
// assignee are derived from it. The trail itself is never edited or removed.

import { randomUUID } from "node:crypto";
import { autodecide, fold, normalizeLog } from "../index.ts";
import type { DecisionRecordedEvent, EvidenceAttachedEvent, EvidenceValue, GateDefinition, GateEvent } from "../types.ts";
import type { Store } from "./store.ts";
import type {
  Assignment,
  AssignInput,
  DecideResult,
  DecisionInput,
  EnqueueInput,
  Inbox,
  InboxCounts,
  InboxSummary,
  LeaseInput,
  Priority,
  QueueItem,
} from "./types.ts";

const PRIORITY_RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2, critical: 3 };

export interface ReviewQueueOptions {
  store: Store;
  /** Default lease (visibility) duration in seconds. Default 300. */
  leaseSeconds?: number;
  /** Run each gate's automation policy on enqueue. Default true. */
  autoDecide?: boolean;
  /** Global webhook fired on enqueue/assign/decide (at-most-once; best-effort). */
  webhook?: string;
  /** Clock injection for tests. Default wall-clock. */
  now?: () => Date;
  /** Notifier injection for tests. Default fetch-based POST. */
  notifier?: (url: string, payload: unknown) => Promise<void>;
}

export interface ReviewQueue {
  ready(): Promise<void>;
  enqueue(input: EnqueueInput): Promise<QueueItem>;
  attachEvidence(id: string, evidence: EvidenceValue, opts?: { actor?: string; at?: string }): Promise<QueueItem>;
  assign(id: string, input: AssignInput): Promise<QueueItem>;
  lease(input?: LeaseInput): Promise<QueueItem | null>;
  decide(id: string, input: DecisionInput): Promise<DecideResult>;
  release(id: string, leaseToken?: string): Promise<QueueItem>;
  get(id: string): Promise<QueueItem | null>;
  list(filter?: { status?: string; domain?: string; inbox?: string; assignee?: string }): Promise<QueueItem[]>;
  createInbox(def: { name: string; description?: string; match?: Inbox["match"] }): Promise<Inbox>;
  listInboxes(): Promise<{ inboxes: InboxSummary[]; unassigned: number }>;
}

export interface QueueError extends Error {
  status: number;
}

function fail(status: number, message: string): never {
  const e = new Error(message) as QueueError;
  e.status = status;
  throw e;
}

const clone = <T>(v: T): T => structuredClone(v);

function cmpTuple(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function createReviewQueue(opts: ReviewQueueOptions): ReviewQueue {
  const store = opts.store;
  const leaseSeconds = opts.leaseSeconds ?? 300;
  const autoDecideOn = opts.autoDecide ?? true;
  const webhook = opts.webhook;
  const now = opts.now ?? (() => new Date());
  const notifier =
    opts.notifier ??
    (async (url: string, payload: unknown) => {
      await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    });

  let items: QueueItem[] = [];
  let inboxes: Inbox[] = [];
  let loading: Promise<void> | null = null;

  function ready(): Promise<void> {
    if (!loading) loading = store.load().then((s) => void ((items = s.items), (inboxes = s.inboxes)));
    return loading;
  }

  const persist = () => store.save({ items, inboxes });

  // Serialize all mutations so concurrent requests can't interleave a
  // read-modify-write against the shared state + file.
  let tail: Promise<unknown> = Promise.resolve();
  function lock<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn);
    tail = result.then(() => {}, () => {});
    return result;
  }

  function ensureInbox(name: string, at: string): void {
    if (!inboxes.some((i) => i.name === name)) inboxes.push({ name, createdAt: at });
  }

  /** Append a delegation entry and update the derived inbox/assignee. */
  function delegate(item: QueueItem, a: Assignment): void {
    item.assignments.push(a);
    if (a.inbox !== undefined) item.inbox = a.inbox;
    if (a.assignee !== undefined) item.assignee = a.assignee;
    item.updatedAt = a.at;
  }

  /** Expire leases and flag SLA breaches. Mutates in place. */
  function reap(at: Date): void {
    const t = at.getTime();
    const tISO = at.toISOString();
    for (const it of items) {
      if (it.status === "leased" && it.lease && Date.parse(it.lease.until) <= t) {
        it.status = "pending";
        it.lease = undefined;
        it.updatedAt = tISO;
        it.history.push(`${tISO} lease expired -> pending`);
      }
      if (it.status !== "decided" && it.dueAt && !it.breachedAt && Date.parse(it.dueAt) <= t) {
        it.breachedAt = tISO;
        const esc = it.gate.sla?.escalateToInbox;
        if (esc) ensureInbox(esc, tISO);
        delegate(it, {
          at: tISO,
          by: "system:sla",
          kind: "escalate",
          inbox: esc ?? it.inbox,
          fromInbox: it.inbox,
          reason: `SLA breach: due ${it.dueAt}`,
        });
        it.history.push(`${tISO} SLA breach -> escalated to ${esc ?? it.inbox ?? "pool"}`);
      }
    }
  }

  function ruleInbox(gate: GateDefinition): string | undefined {
    const hit = inboxes.find(
      (i) =>
        i.match &&
        (!i.match.domain || i.match.domain === gate.domain) &&
        (!i.match.gateId || i.match.gateId === gate.id) &&
        (!i.match.reviewerRole || i.match.reviewerRole === gate.reviewer?.role),
    );
    return hit?.name;
  }

  async function notify(item: QueueItem, event: string): Promise<void> {
    const targets = [item.notify, webhook].filter((u): u is string => !!u);
    if (targets.length === 0) return;
    const payload = {
      event,
      id: item.id,
      gate: item.gateId,
      domain: item.gate.domain,
      status: item.status,
      inbox: item.inbox,
      assignee: item.assignee,
      reviewerRole: item.gate.reviewer?.role,
      at: now().toISOString(),
    };
    for (const url of targets) {
      try {
        await notifier(url, payload);
      } catch {
        // Push is at-most-once and best-effort: the queue is the source of
        // truth, a reviewer can always pull instead.
      }
    }
  }

  function eventsOf(input: EnqueueInput): GateEvent[] {
    if (Array.isArray(input.events)) return input.events;
    if (Array.isArray(input.scenario?.events)) return input.scenario.events;
    return [];
  }

  function countFor(name: string, tMs: number): InboxCounts {
    const its = items.filter((i) => i.inbox === name);
    const breachedNow = (i: QueueItem) =>
      i.status !== "decided" && (!!i.breachedAt || (!!i.dueAt && Date.parse(i.dueAt) <= tMs));
    const dueSoon = (i: QueueItem) => {
      if (i.status === "decided" || i.breachedAt || !i.dueAt) return false;
      const due = Date.parse(i.dueAt);
      if (due <= tMs) return false;
      const window = due - Date.parse(i.enqueuedAt);
      return window > 0 && due - tMs <= window * 0.25;
    };
    return {
      pending: its.filter((i) => i.status === "pending").length,
      leased: its.filter((i) => i.status === "leased").length,
      decided: its.filter((i) => i.status === "decided").length,
      breached: its.filter(breachedNow).length,
      dueSoon: its.filter(dueSoon).length,
      total: its.length,
    };
  }

  return {
    ready,

    async enqueue(input) {
      await ready();
      return lock(async () => {
        const gate = input.gate;
        if (!gate || !gate.id) fail(400, "enqueue requires a gate definition with an id");
        const id = randomUUID();
        const t = now();
        const tISO = t.toISOString();
        let events = normalizeLog(id, eventsOf(input));
        let state = fold(gate, events);

        const item: QueueItem = {
          id,
          status: "pending",
          gateId: gate.id,
          gate,
          events,
          state,
          allowedDecisions: gate.decisions ?? [],
          assignments: [],
          enqueuedAt: tISO,
          updatedAt: tISO,
          maxFence: 0,
          notify: input.notify,
          history: [`${tISO} enqueued (gate status=${state.status})`],
        };

        // SLA: a deterministic due date set at enqueue.
        if (gate.sla) {
          item.priority = gate.sla.priority ?? "normal";
          item.dueAt = new Date(t.getTime() + gate.sla.reviewWithinHours * 3_600_000).toISOString();
        }

        const target = input.inbox ?? ruleInbox(gate);
        if (target || input.assignee) {
          if (target) ensureInbox(target, tISO);
          delegate(item, { at: tISO, by: input.by ?? "system:router", kind: "route", inbox: target, assignee: input.assignee, reason: input.reason });
          item.history.push(`${tISO} routed to ${target ?? "-"}${input.assignee ? " / " + input.assignee : ""}`);
        }

        if (state.decision) {
          item.status = "decided";
          item.decidedBy = state.decision.by;
          item.history.push(`${tISO} already decided in submitted log (${state.decision.outcome})`);
        } else if (autoDecideOn) {
          const auto = autodecide(gate, state, tISO);
          if (auto) {
            events = [...events, auto];
            state = fold(gate, events);
            item.events = events;
            item.state = state;
            item.status = "decided";
            item.decidedBy = auto.actor;
            item.history.push(`${tISO} auto-decided by policy (${auto.outcome})`);
          }
        }

        items.push(item);
        await persist();
        void notify(item, item.status === "decided" ? "decided" : "enqueued");
        return clone(item);
      });
    },

    async attachEvidence(id, evidence, opts = {}) {
      await ready();
      return lock(async () => {
        const item = items.find((it) => it.id === id);
        if (!item) fail(404, `no queue item "${id}"`);
        if (item.status === "decided") fail(409, `item "${id}" is already decided`);
        const at = opts.at ?? now().toISOString();
        const nextSeq = item.state.seq + 1;
        const ev: EvidenceAttachedEvent = {
          id: `${item.id}#${nextSeq}`,
          seq: nextSeq,
          type: "evidence.attached",
          at,
          actor: opts.actor ?? "system",
          evidence,
        };
        item.events = [...item.events, ev];
        item.state = fold(item.gate, item.events);
        item.updatedAt = at;
        item.history.push(`${at} evidence "${evidence.kind}" attached by ${ev.actor}`);
        await persist();
        void notify(item, "evidence");
        return clone(item);
      });
    },

    async assign(id, input) {
      await ready();
      return lock(async () => {
        const item = items.find((it) => it.id === id);
        if (!item) fail(404, `no queue item "${id}"`);
        if (item.status === "decided") fail(409, `item "${id}" is already decided`);
        if (!input.by) fail(400, "assign requires 'by' (a delegation trace must name its author)");
        if (input.inbox === undefined && input.assignee === undefined) fail(400, "assign requires an inbox and/or an assignee");

        const at = now().toISOString();
        const fromInbox = item.inbox;
        const fromAssignee = item.assignee;
        const kind: Assignment["kind"] =
          input.kind ?? (fromInbox === undefined && fromAssignee === undefined ? "route" : "reassign");

        if (input.inbox) ensureInbox(input.inbox, at);
        delegate(item, { at, by: input.by, kind, inbox: input.inbox, assignee: input.assignee, fromInbox, fromAssignee, reason: input.reason });
        item.history.push(`${at} ${kind} -> ${input.inbox ?? item.inbox ?? "-"}${input.assignee ? " / " + input.assignee : ""} by ${input.by}`);
        await persist();
        void notify(item, "assigned");
        return clone(item);
      });
    },

    async lease(input = {}) {
      await ready();
      return lock(async () => {
        const t = now();
        reap(t);
        const dur = (input.leaseSeconds ?? leaseSeconds) * 1000;
        const matches = items.filter(
          (it) =>
            it.status === "pending" &&
            (!input.inbox || it.inbox === input.inbox) &&
            (!input.assignee || it.assignee === input.assignee || it.assignee === undefined) &&
            (!input.domain || it.gate.domain === input.domain) &&
            (!input.role || it.gate.reviewer?.role === input.role),
        );
        if (matches.length === 0) return null;

        // Most overdue, then highest priority, then soonest due, then FIFO.
        const rank = (i: QueueItem): number[] => [
          i.breachedAt ? 0 : 1,
          -PRIORITY_RANK[i.priority ?? "normal"],
          i.dueAt ? Date.parse(i.dueAt) : Number.MAX_SAFE_INTEGER,
          Date.parse(i.enqueuedAt),
        ];
        const candidate = [...matches].sort((a, b) => cmpTuple(rank(a), rank(b)))[0];

        const tISO = t.toISOString();
        const fence = (candidate.maxFence ?? 0) + 1;
        candidate.maxFence = fence;
        candidate.status = "leased";
        candidate.lease = { token: randomUUID(), fence, holder: input.holder, until: new Date(t.getTime() + dur).toISOString() };
        if (input.holder) {
          delegate(candidate, { at: tISO, by: input.holder, kind: "claim", inbox: candidate.inbox, assignee: input.holder, fromAssignee: candidate.assignee });
        } else {
          candidate.updatedAt = tISO;
        }
        candidate.history.push(`${tISO} leased by ${input.holder ?? "anon"} (fence ${fence}) until ${candidate.lease.until}`);
        await persist();
        return clone(candidate);
      });
    },

    async decide(id, input) {
      await ready();
      return lock(async () => {
        const item = items.find((it) => it.id === id);
        if (!item) fail(404, `no queue item "${id}"`);

        const t = now();
        reap(t);

        if (item.status === "decided") {
          // Idempotent retry: same key -> return the first result, don't double-fire.
          if (input.idempotencyKey && item.decisionKey === input.idempotencyKey) {
            return { item: clone(item), state: item.state };
          }
          fail(409, `item "${id}" is already decided`);
        }

        // Fencing: a leased case can only be decided under the current lease token.
        if (item.status === "leased") {
          if (!input.leaseToken) fail(409, "case is leased; a lease token is required to decide");
          if (input.leaseToken !== item.lease?.token) fail(409, "stale lease: token does not match the active lease");
        }

        const at = input.at ?? t.toISOString();
        const nextSeq = item.state.seq + 1;
        const decision: DecisionRecordedEvent = {
          id: `${item.id}#${nextSeq}`,
          seq: nextSeq,
          type: "decision.recorded",
          at,
          actor: input.actor,
          reviewerRole: input.reviewerRole,
          outcome: input.outcome,
          acceptedValues: input.acceptedValues,
          note: input.note,
        };
        const events = [...item.events, decision];
        const state = fold(item.gate, events);

        if (!state.decision) {
          // The engine refused: wrong reviewer role, or a positive outcome while
          // blocking checks are unmet. Keep it reviewable and say why.
          item.status = item.lease ? "leased" : "pending";
          item.updatedAt = at;
          const reason = state.log[state.log.length - 1] ?? "decision refused";
          item.history.push(`${at} decision "${input.outcome}" refused: ${reason}`);
          await persist();
          fail(422, reason);
        }

        item.events = events;
        item.state = state;
        item.status = "decided";
        item.decidedBy = input.actor;
        item.decisionKey = input.idempotencyKey;
        item.lease = undefined;
        item.updatedAt = at;
        item.history.push(`${at} decided "${state.decision.outcome}" by ${input.actor} (${input.reviewerRole})`);
        await persist();
        void notify(item, "decided");
        return { item: clone(item), state };
      });
    },

    async release(id, leaseToken) {
      await ready();
      return lock(async () => {
        const item = items.find((it) => it.id === id);
        if (!item) fail(404, `no queue item "${id}"`);
        if (item.status === "decided") fail(409, `item "${id}" is already decided`);
        if (item.lease && leaseToken && item.lease.token !== leaseToken) fail(409, "lease token does not match the active lease");
        const at = now().toISOString();
        const holder = item.lease?.holder ?? "anon";
        item.status = "pending";
        item.lease = undefined;
        delegate(item, { at, by: holder, kind: "release", inbox: item.inbox, assignee: undefined, fromAssignee: item.assignee });
        item.assignee = undefined;
        item.history.push(`${at} released back to ${item.inbox ?? "pool"} by ${holder}`);
        await persist();
        return clone(item);
      });
    },

    async get(id) {
      await ready();
      const item = items.find((it) => it.id === id);
      return item ? clone(item) : null;
    },

    async list(filter = {}) {
      await ready();
      return items
        .filter(
          (it) =>
            (!filter.status || it.status === filter.status) &&
            (!filter.domain || it.gate.domain === filter.domain) &&
            (filter.inbox === undefined || it.inbox === filter.inbox) &&
            (!filter.assignee || it.assignee === filter.assignee),
        )
        .map(clone);
    },

    async createInbox(def) {
      await ready();
      return lock(async () => {
        if (!def.name) fail(400, "inbox requires a name");
        const at = now().toISOString();
        let ib = inboxes.find((i) => i.name === def.name);
        if (ib) {
          if (def.description !== undefined) ib.description = def.description;
          if (def.match !== undefined) ib.match = def.match;
        } else {
          ib = { name: def.name, description: def.description, match: def.match, createdAt: at };
          inboxes.push(ib);
        }
        await persist();
        return clone(ib);
      });
    },

    async listInboxes() {
      await ready();
      return lock(async () => {
        const t = now();
        reap(t);
        await persist();
        const tMs = t.getTime();
        return {
          inboxes: inboxes.map((ib) => ({ ...clone(ib), counts: countFor(ib.name, tMs) })),
          unassigned: items.filter((i) => i.inbox === undefined).length,
        };
      });
    },
  };
}
