import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadGate, type GateDefinition, type GateEvent } from "../src/index.ts";
import { createReviewQueue, type ReviewQueueOptions } from "../src/queue/queue.ts";
import { createMemoryStore } from "../src/queue/store.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(here + rel, "utf8"));

const gate: GateDefinition = loadGate(read("../../examples/construction/gate.json"));
const accept = read("../../examples/construction/scenario.accept.json");

// Events without the final decision: a real case awaiting a reviewer.
const pendingEvents: GateEvent[] = accept.events.slice(0, -1);

// Claim 120 vs survey 100 = 16.7% — outside the 5% cross-check tolerance.
const badEvents: GateEvent[] = [
  {
    type: "claim.submitted",
    at: "2026-06-01T09:00:00Z",
    actor: "contractor:alfa",
    claim: {
      type: "work_volume_completed",
      values: { work_item: "x", quantity: 120, period: "2026-05" },
    },
  },
  {
    type: "evidence.attached",
    at: "2026-06-02T09:00:00Z",
    actor: "surveyor:geo",
    evidence: { kind: "survey_measurement", values: { quantity: 100 } },
  },
];

// A small claim within the policy ceiling (10 * 85 = 850 <= 2000).
const smallEvents: GateEvent[] = [
  {
    type: "claim.submitted",
    at: "2026-06-01T09:00:00Z",
    actor: "contractor:alfa",
    claim: {
      type: "work_volume_completed",
      values: { work_item: "patch", quantity: 10, period: "2026-05" },
    },
  },
  {
    type: "evidence.attached",
    at: "2026-06-02T09:00:00Z",
    actor: "surveyor:geo",
    evidence: { kind: "survey_measurement", values: { quantity: 10 } },
  },
];

/** A queue with a controllable clock and a recording notifier. */
function makeQueue(over: Partial<ReviewQueueOptions> = {}) {
  let clock = new Date("2026-06-10T00:00:00Z");
  const pushes: Array<{ url: string; payload: unknown }> = [];
  const queue = createReviewQueue({
    store: createMemoryStore(),
    leaseSeconds: 60,
    now: () => clock,
    notifier: async (url, payload) => void pushes.push({ url, payload }),
    ...over,
  });
  return {
    queue,
    pushes,
    advance: (seconds: number) => {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
  };
}

test("enqueue: a case with passing checks waits for a human (above auto ceiling)", async () => {
  const { queue } = makeQueue();
  const item = await queue.enqueue({ gate, events: pendingEvents });

  assert.equal(item.status, "pending");
  assert.equal(item.state.checksPassed, true);
  assert.equal(item.state.status, "under_review");
  assert.ok(item.allowedDecisions.includes("accepted"));
  // 10200 EUR > policy maxAmount (2000) -> not auto-decided.
  assert.equal(item.decidedBy, undefined);
});

test("push: a webhook fires on enqueue when configured", async () => {
  const { queue, pushes } = makeQueue({ webhook: "https://hook.test/notify" });
  await queue.enqueue({ gate, events: pendingEvents });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, "https://hook.test/notify");
  assert.equal((pushes[0].payload as { event: string }).event, "enqueued");
});

test("pull: lease hands out the next pending case once, with a token", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });

  const leased = await queue.lease({ holder: "claude" });
  assert.ok(leased);
  assert.equal(leased.id, enq.id);
  assert.equal(leased.status, "leased");
  assert.ok(leased.lease?.token);

  // Nothing else pending -> second pull is empty.
  assert.equal(await queue.lease(), null);
});

test("decide: the reviewer's acceptance is folded in and consequences fire", async () => {
  const { queue, pushes } = makeQueue({ webhook: "https://hook.test/notify" });
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const leased = await queue.lease({ holder: "claude" });

  const { item, state } = await queue.decide(enq.id, {
    outcome: "accepted",
    reviewerRole: "technical_supervisor",
    actor: "supervisor:ivanov",
    leaseToken: leased!.lease!.token,
    note: "within tolerance",
  });

  assert.equal(item.status, "decided");
  assert.equal(state.status, "accepted");
  assert.equal(state.consequences.find((c) => c.effect === "money")?.amount, 10200);
  assert.equal(state.responsibility?.role, "technical_supervisor");

  // A decided item cannot be decided again.
  await assert.rejects(
    queue.decide(enq.id, {
      outcome: "rejected",
      reviewerRole: "technical_supervisor",
      actor: "x",
    }),
    (e: { status?: number }) => e.status === 409,
  );

  // The decide push fired (enqueue + decide = 2).
  assert.equal(pushes.length, 2);
  assert.equal((pushes[1].payload as { event: string }).event, "decided");
});

test("decide: the engine refuses a wrong-role decision (422), item stays reviewable", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  await queue.lease();

  await assert.rejects(
    queue.decide(enq.id, {
      outcome: "accepted",
      reviewerRole: "contractor", // not the gate's reviewer role
      actor: "contractor:alfa",
    }),
    (e: { status?: number }) => e.status === 422,
  );

  const after = await queue.get(enq.id);
  assert.equal(after?.status, "pending");
  assert.equal(after?.state.decision, undefined);
});

test("decide: acceptance is refused while blocking checks fail; rework is allowed", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: badEvents });
  assert.equal(enq.status, "pending");
  assert.equal(enq.state.checksPassed, false);

  await assert.rejects(
    queue.decide(enq.id, {
      outcome: "accepted",
      reviewerRole: "technical_supervisor",
      actor: "supervisor:ivanov",
    }),
    (e: { status?: number }) => e.status === 422,
  );

  // A non-positive outcome does not require passing checks.
  const { item, state } = await queue.decide(enq.id, {
    outcome: "returned_for_rework",
    reviewerRole: "technical_supervisor",
    actor: "supervisor:ivanov",
  });
  assert.equal(item.status, "decided");
  assert.equal(state.status, "returned_for_rework");
});

test("automation: a small in-policy claim auto-decides on enqueue", async () => {
  const { queue, pushes } = makeQueue({ webhook: "https://hook.test/notify" });
  const item = await queue.enqueue({ gate, events: smallEvents });

  assert.equal(item.status, "decided");
  assert.equal(item.decidedBy, "system:auto");
  assert.equal(item.state.status, "accepted");
  assert.equal(item.state.consequences.find((c) => c.effect === "money")?.amount, 850);

  // Auto-decided items are not handed out for review.
  assert.equal(await queue.lease(), null);
  assert.equal((pushes[0].payload as { event: string }).event, "decided");
});

test("lease expiry: an abandoned lease returns to the pool", async () => {
  const { queue, advance } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });

  const first = await queue.lease({ holder: "a", leaseSeconds: 60 });
  assert.equal(first?.id, enq.id);
  assert.equal(await queue.lease({ holder: "b" }), null); // still leased

  advance(61);
  const reclaimed = await queue.lease({ holder: "b" });
  assert.equal(reclaimed?.id, enq.id);
  assert.notEqual(reclaimed?.lease?.token, first?.lease?.token);
});

test("release: a leased case can be handed back without deciding", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const leased = await queue.lease({ holder: "a" });

  const released = await queue.release(enq.id, leased!.lease!.token);
  assert.equal(released.status, "pending");
  assert.equal(released.lease, undefined);

  // Immediately leasable again.
  assert.equal((await queue.lease({ holder: "b" }))?.id, enq.id);
});

test("filters: lease respects domain and reviewer role", async () => {
  const { queue } = makeQueue();
  await queue.enqueue({ gate, events: pendingEvents });

  assert.equal(await queue.lease({ domain: "logistics" }), null);
  assert.equal(await queue.lease({ role: "contractor" }), null);
  assert.ok(await queue.lease({ domain: "construction", role: "technical_supervisor" }));
});

test("list: cases can be filtered by queue status", async () => {
  const { queue } = makeQueue();
  await queue.enqueue({ gate, events: pendingEvents });
  await queue.enqueue({ gate, events: smallEvents }); // auto-decided

  assert.equal((await queue.list()).length, 2);
  assert.equal((await queue.list({ status: "pending" })).length, 1);
  assert.equal((await queue.list({ status: "decided" })).length, 1);
});

test("inbox: a routing rule sends matching cases to an inbox, with a trace", async () => {
  const { queue } = makeQueue();
  await queue.createInbox({
    name: "supervisors",
    match: { reviewerRole: "technical_supervisor" },
  });
  const item = await queue.enqueue({ gate, events: pendingEvents });

  assert.equal(item.inbox, "supervisors");
  // The routing left an immutable trace.
  assert.equal(item.assignments.length, 1);
  assert.equal(item.assignments[0].kind, "route");
  assert.equal(item.assignments[0].inbox, "supervisors");
  assert.equal(item.assignments[0].by, "system:router");

  // Pulling scoped to the inbox finds it; the wrong inbox does not.
  assert.equal(await queue.lease({ inbox: "logistics" }), null);
  assert.equal((await queue.lease({ inbox: "supervisors", holder: "ivanov" }))?.id, item.id);
});

test("delegation: assign reassigns and appends to the trail; prior entries are untouched", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents, inbox: "intake", by: "router" });
  assert.equal(enq.inbox, "intake");
  const firstTrace = enq.assignments[0];

  const reassigned = await queue.assign(enq.id, {
    inbox: "supervisors",
    assignee: "ivanov",
    by: "dispatcher:lena",
    reason: "Ivanov owns the foundation package",
  });

  assert.equal(reassigned.inbox, "supervisors");
  assert.equal(reassigned.assignee, "ivanov");
  // Append-only: the trail grew, the original entry is byte-for-byte unchanged.
  assert.equal(reassigned.assignments.length, 2);
  assert.deepEqual(reassigned.assignments[0], firstTrace);
  const last = reassigned.assignments[1];
  assert.equal(last.kind, "reassign");
  assert.equal(last.fromInbox, "intake");
  assert.equal(last.by, "dispatcher:lena");
  assert.equal(last.reason, "Ivanov owns the foundation package");
});

test("delegation: a trace must name its author and a destination", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });

  await assert.rejects(
    // @ts-expect-error — 'by' is required
    queue.assign(enq.id, { inbox: "supervisors" }),
    (e: { status?: number }) => e.status === 400,
  );
  await assert.rejects(
    queue.assign(enq.id, { by: "dispatcher" }),
    (e: { status?: number }) => e.status === 400,
  );
});

test("trace: claim, release and decision all leave entries that survive on the item", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents, inbox: "supervisors", by: "router" });

  await queue.lease({ inbox: "supervisors", holder: "ivanov" });
  const afterLease = await queue.get(enq.id);
  assert.equal(afterLease?.assignee, "ivanov");
  assert.ok(afterLease?.assignments.some((a) => a.kind === "claim" && a.by === "ivanov"));

  const released = await queue.release(enq.id);
  assert.equal(released.assignee, undefined);
  assert.ok(released.assignments.some((a) => a.kind === "release"));

  // Re-lease and decide; the full delegation trail persists post-decision.
  const leased = await queue.lease({ inbox: "supervisors", holder: "ivanov" });
  const { item } = await queue.decide(enq.id, {
    outcome: "accepted",
    reviewerRole: "technical_supervisor",
    actor: "ivanov",
    leaseToken: leased!.lease!.token,
  });
  assert.equal(item.status, "decided");
  const kinds = item.assignments.map((a) => a.kind);
  assert.deepEqual(kinds, ["route", "claim", "release", "claim"]);
});

test("inbox: listInboxes reports per-inbox counts and unassigned total", async () => {
  const { queue } = makeQueue();
  await queue.createInbox({ name: "supervisors" });
  await queue.enqueue({ gate, events: pendingEvents, inbox: "supervisors", by: "router" });
  await queue.enqueue({ gate, events: pendingEvents }); // unassigned

  const { inboxes, unassigned } = await queue.listInboxes();
  const sup = inboxes.find((i) => i.name === "supervisors");
  assert.equal(sup?.counts.pending, 1);
  assert.equal(sup?.counts.total, 1);
  assert.equal(unassigned, 1);
});
