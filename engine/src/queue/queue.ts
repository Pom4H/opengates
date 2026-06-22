// The review queue.
//
// A small, dependency-free primitive that turns the fold engine into a
// push & pull review workflow with delegation:
//
//   enqueue  (push)   -> a case awaits review, routed to an inbox if a rule fits
//   assign   (route)  -> delegate a case to an inbox and/or a participant
//   lease    (pull)   -> a reviewer takes the next matching case, with a timeout
//   decide            -> the reviewer's outcome is folded in; consequences fire
//   release           -> hand a leased case back without deciding
//
// Reviewers are pluggable: a Claude skill, another agent harness, or a human
// hitting the HTTP API. The queue does not care who decides — only that the
// gate's reviewer role and its blocking checks are respected (enforced by the
// engine's fold).
//
// DELEGATION LEAVES A TRACE. Every route/reassign/claim/release/escalate appends
// an immutable entry to the item's `assignments` trail. The current inbox and
// assignee are derived from it; the trail itself is never edited or removed.

import { randomUUID } from "node:crypto";
import { autodecide, fold } from "../index.ts";
import type { DecisionRecordedEvent, GateDefinition, GateEvent } from "../types.ts";
import type { Store } from "./store.ts";
import type {
  Assignment,
  AssignInput,
  DecideResult,
  DecisionInput,
  EnqueueInput,
  Inbox,
  InboxSummary,
  LeaseInput,
  QueueItem,
} from "./types.ts";

export interface ReviewQueueOptions {
  store: Store;
  /** Default lease (visibility) duration in seconds. Default 300. */
  leaseSeconds?: number;
  /** Run each gate's automation policy on enqueue. Default true. */
  autoDecide?: boolean;
  /** Global webhook fired on enqueue/assign/decide (best-effort push). */
  webhook?: string;
  /** Clock injection for tests. Default wall-clock. */
  now?: () => Date;
  /** Notifier injection for tests. Default fetch-based POST. */
  notifier?: (url: string, payload: unknown) => Promise<void>;
}

export interface ReviewQueue {
  /** Load persisted state. Idempotent; called lazily by every method. */
  ready(): Promise<void>;
  enqueue(input: EnqueueInput): Promise<QueueItem>;
  assign(id: string, input: AssignInput): Promise<QueueItem>;
  lease(input?: LeaseInput): Promise<QueueItem | null>;
  decide(id: string, input: DecisionInput): Promise<DecideResult>;
  release(id: string, leaseToken?: string): Promise<QueueItem>;
  get(id: string): Promise<QueueItem | null>;
  list(filter?: {
    status?: string;
    domain?: string;
    inbox?: string;
    assignee?: string;
  }): Promise<QueueItem[]>;
  createInbox(def: {
    name: string;
    description?: string;
    match?: Inbox["match"];
  }): Promise<Inbox>;
  listInboxes(): Promise<{ inboxes: InboxSummary[]; unassigned: number }>;
}

/** A thrown Error carrying an HTTP status the API layer maps directly. */
export interface QueueError extends Error {
  status: number;
}

function fail(status: number, message: string): never {
  const e = new Error(message) as QueueError;
  e.status = status;
  throw e;
}

const clone = <T>(v: T): T => structuredClone(v);

export function createReviewQueue(opts: ReviewQueueOptions): ReviewQueue {
  const store = opts.store;
  const leaseSeconds = opts.leaseSeconds ?? 300;
  const autoDecideOn = opts.autoDecide ?? true;
  const webhook = opts.webhook;
  const now = opts.now ?? (() => new Date());
  const notifier =
    opts.notifier ??
    (async (url: string, payload: unknown) => {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    });

  let items: QueueItem[] = [];
  let inboxes: Inbox[] = [];
  let loading: Promise<void> | null = null;

  function ready(): Promise<void> {
    if (!loading) {
      loading = store.load().then((s) => {
        items = s.items;
        inboxes = s.inboxes;
      });
    }
    return loading;
  }

  const persist = () => store.save({ items, inboxes });

  // Serialize all mutations so concurrent requests can't interleave a
  // read-modify-write against the shared state + file.
  let tail: Promise<unknown> = Promise.resolve();
  function lock<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  /** Return expired leases to the pending pool. Mutates in place. */
  function reap(at: Date): void {
    const t = at.getTime();
    for (const it of items) {
      if (it.status === "leased" && it.lease && Date.parse(it.lease.until) <= t) {
        it.status = "pending";
        it.lease = undefined;
        it.updatedAt = at.toISOString();
        it.history.push(`${at.toISOString()} lease expired -> pending`);
      }
    }
  }

  function ensureInbox(name: string, at: string): void {
    if (!inboxes.some((i) => i.name === name)) {
      inboxes.push({ name, createdAt: at });
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

  /** Append a delegation entry and update the derived inbox/assignee. */
  function delegate(item: QueueItem, a: Assignment): void {
    item.assignments.push(a);
    if (a.inbox !== undefined) item.inbox = a.inbox;
    if (a.assignee !== undefined) item.assignee = a.assignee;
    item.updatedAt = a.at;
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
        // Push is best-effort: a reviewer can always pull instead.
      }
    }
  }

  function eventsOf(input: EnqueueInput): GateEvent[] {
    if (Array.isArray(input.events)) return input.events;
    if (Array.isArray(input.scenario?.events)) return input.scenario.events;
    return [];
  }

  function countFor(name: string) {
    const its = items.filter((i) => i.inbox === name);
    return {
      pending: its.filter((i) => i.status === "pending").length,
      leased: its.filter((i) => i.status === "leased").length,
      decided: its.filter((i) => i.status === "decided").length,
      total: its.length,
    };
  }

  return {
    ready,

    async enqueue(input) {
      await ready();
      return lock(async () => {
        const gate = input.gate;
        if (!gate || !gate.id) {
          fail(400, "enqueue requires a gate definition with an id");
        }
        const t = now();
        const tISO = t.toISOString();
        let events = eventsOf(input);
        let state = fold(gate, events);

        const item: QueueItem = {
          id: randomUUID(),
          status: "pending",
          gateId: gate.id,
          gate,
          events,
          state,
          allowedDecisions: gate.decisions ?? [],
          assignments: [],
          enqueuedAt: tISO,
          updatedAt: tISO,
          notify: input.notify,
          history: [`${tISO} enqueued (gate status=${state.status})`],
        };

        // Route: explicit inbox/assignee, else a matching inbox rule. A routing
        // that lands anywhere leaves a trace.
        const target = input.inbox ?? ruleInbox(gate);
        if (target || input.assignee) {
          if (target) ensureInbox(target, tISO);
          delegate(item, {
            at: tISO,
            by: input.by ?? "system:router",
            kind: "route",
            inbox: target,
            assignee: input.assignee,
            reason: input.reason,
          });
          item.history.push(
            `${tISO} routed to ${target ?? "-"}${input.assignee ? " / " + input.assignee : ""}`,
          );
        }

        if (state.decision) {
          // The submitted log already carried a decision — nothing to review.
          item.status = "decided";
          item.decidedBy = state.decision.by;
          item.history.push(
            `${tISO} already decided in submitted log (${state.decision.outcome})`,
          );
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

    async assign(id, input) {
      await ready();
      return lock(async () => {
        const item = items.find((it) => it.id === id);
        if (!item) fail(404, `no queue item "${id}"`);
        if (item.status === "decided") fail(409, `item "${id}" is already decided`);
        if (!input.by) fail(400, "assign requires 'by' (a delegation trace must name its author)");
        if (input.inbox === undefined && input.assignee === undefined) {
          fail(400, "assign requires an inbox and/or an assignee");
        }

        const at = now().toISOString();
        const fromInbox = item.inbox;
        const fromAssignee = item.assignee;
        // The first placement is a route; any later redirect is a reassign.
        const kind: Assignment["kind"] =
          input.kind ??
          (fromInbox === undefined && fromAssignee === undefined
            ? "route"
            : "reassign");

        if (input.inbox) ensureInbox(input.inbox, at);
        delegate(item, {
          at,
          by: input.by,
          kind,
          inbox: input.inbox,
          assignee: input.assignee,
          fromInbox,
          fromAssignee,
          reason: input.reason,
        });
        item.history.push(
          `${at} ${kind} -> ${input.inbox ?? item.inbox ?? "-"}${
            input.assignee ? " / " + input.assignee : ""
          } by ${input.by}`,
        );
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
        const candidate = items.find(
          (it) =>
            it.status === "pending" &&
            (!input.inbox || it.inbox === input.inbox) &&
            (!input.assignee ||
              it.assignee === input.assignee ||
              it.assignee === undefined) &&
            (!input.domain || it.gate.domain === input.domain) &&
            (!input.role || it.gate.reviewer?.role === input.role),
        );
        if (!candidate) return null;

        const tISO = t.toISOString();
        candidate.status = "leased";
        candidate.lease = {
          token: randomUUID(),
          holder: input.holder,
          until: new Date(t.getTime() + dur).toISOString(),
        };
        // Taking a case is itself a delegation (self-assignment): trace it.
        if (input.holder) {
          delegate(candidate, {
            at: tISO,
            by: input.holder,
            kind: "claim",
            inbox: candidate.inbox,
            assignee: input.holder,
            fromAssignee: candidate.assignee,
          });
        } else {
          candidate.updatedAt = tISO;
        }
        candidate.history.push(
          `${tISO} leased by ${input.holder ?? "anon"} until ${candidate.lease.until}`,
        );
        await persist();
        return clone(candidate);
      });
    },

    async decide(id, input) {
      await ready();
      return lock(async () => {
        const item = items.find((it) => it.id === id);
        if (!item) fail(404, `no queue item "${id}"`);
        if (item.status === "decided") fail(409, `item "${id}" is already decided`);

        const t = now();
        reap(t);
        if (item.lease && input.leaseToken && item.lease.token !== input.leaseToken) {
          fail(409, "lease token does not match the active lease");
        }

        const at = input.at ?? t.toISOString();
        const decision: DecisionRecordedEvent = {
          type: "decision.recorded",
          at,
          actor: input.actor,
          reviewerRole: input.reviewerRole,
          outcome: input.outcome,
          note: input.note,
        };
        const events = [...item.events, decision];
        const state = fold(item.gate, events);

        if (!state.decision) {
          // The engine refused the decision: wrong reviewer role, or a positive
          // outcome while blocking checks are unmet. Keep it reviewable and say why.
          item.status = "pending";
          item.lease = undefined;
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
        item.lease = undefined;
        item.updatedAt = at;
        item.history.push(
          `${at} decided "${state.decision.outcome}" by ${input.actor} (${input.reviewerRole})`,
        );
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
        if (item.lease && leaseToken && item.lease.token !== leaseToken) {
          fail(409, "lease token does not match the active lease");
        }
        const at = now().toISOString();
        const holder = item.lease?.holder ?? "anon";
        item.status = "pending";
        item.lease = undefined;
        // Releasing hands the case back to its inbox: trace it.
        delegate(item, {
          at,
          by: holder,
          kind: "release",
          inbox: item.inbox,
          assignee: undefined,
          fromAssignee: item.assignee,
        });
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
          ib = {
            name: def.name,
            description: def.description,
            match: def.match,
            createdAt: at,
          };
          inboxes.push(ib);
        }
        await persist();
        return clone(ib);
      });
    },

    async listInboxes() {
      await ready();
      return {
        inboxes: inboxes.map((ib) => ({ ...clone(ib), counts: countFor(ib.name) })),
        unassigned: items.filter((i) => i.inbox === undefined).length,
      };
    },
  };
}
