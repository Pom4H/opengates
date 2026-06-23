import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadGate, type FiredEffect, type GateDefinition } from "../src/index.ts";
import { createReviewQueue, type ReviewQueueOptions } from "../src/queue/queue.ts";
import { createMemoryStore } from "../src/queue/store.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(here + rel, "utf8"));

const gate: GateDefinition = loadGate(read("../../../examples/construction/gate.json"));
const accept = read("../../../examples/construction/scenario.accept.json");

// Claim 120 + full executive documentation, surveyed 117. Awaiting a reviewer.
const pendingEvents = accept.events.slice(0, -1);

const evidence = (kind: string, values?: Record<string, unknown>, ref = `${kind}.pdf`) => ({
  type: "evidence.attached",
  at: "2026-06-02T09:00:00Z",
  actor: "x",
  evidence: { kind, values, ref },
});
const claim = (quantity: number) => ({
  type: "claim.submitted",
  at: "2026-06-01T09:00:00Z",
  actor: "contractor:alfa",
  claim: { type: "work_volume_completed", values: { work_item: "x", quantity, period: "2026-05" } },
});
const fullDocs = (qty: number) => [
  claim(qty),
  evidence("executive_survey", { quantity: qty, unit: "m3" }),
  evidence("concrete_strength_protocol", { grade: "C25/30" }),
  evidence("works_log"),
  evidence("aosr_ref", { act: "AOSR-1" }),
];

// Claim 120 vs survey 100 = 20% of reference -> outside tolerance.
const badEvents = [claim(120), evidence("executive_survey", { quantity: 100, unit: "m3" })];
// A small, fully-evidenced claim within the auto ceiling (10 × 85 net 807.50 <= 2000).
const smallEvents = fullDocs(10);

const moneyOf = (s: { consequences: FiredEffect[] }) =>
  s.consequences.find((c) => c.effect === "money")?.payload as Record<string, number> | undefined;

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
  return { queue, pushes, advance: (s: number) => void (clock = new Date(clock.getTime() + s * 1000)) };
}

test("enqueue: a passing case above the auto ceiling waits for a human", async () => {
  const { queue } = makeQueue();
  const item = await queue.enqueue({ gate, events: pendingEvents });
  assert.equal(item.status, "pending");
  assert.equal(item.state.checksPassed, true);
  assert.equal(item.state.status, "under_review");
  assert.equal(item.decidedBy, undefined);
  // SLA due date is computed at enqueue.
  assert.ok(item.dueAt);
  assert.equal(item.priority, "normal");
});

test("push: a webhook fires on enqueue when configured", async () => {
  const { queue, pushes } = makeQueue({ webhook: "https://hook.test/notify" });
  await queue.enqueue({ gate, events: pendingEvents });
  assert.equal(pushes.length, 1);
  assert.equal((pushes[0].payload as { event: string }).event, "enqueued");
});

test("pull: lease hands out the next case once, with a fenced token", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const leased = await queue.lease({ holder: "claude" });
  assert.equal(leased?.id, enq.id);
  assert.equal(leased?.status, "leased");
  assert.ok(leased?.lease?.token);
  assert.equal(leased?.lease?.fence, 1);
  assert.equal(await queue.lease(), null);
});

test("decide: acceptance is folded in and pays the surveyed quantity (117), less retention", async () => {
  const { queue, pushes } = makeQueue({ webhook: "https://hook.test/notify" });
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const leased = await queue.lease({ holder: "claude" });

  const { item, state } = await queue.decide(enq.id, {
    outcome: "accepted",
    reviewerRole: "technical_supervisor",
    actor: "supervisor:ivanov",
    leaseToken: leased!.lease!.token,
  });

  assert.equal(item.status, "decided");
  assert.equal(state.status, "accepted");
  assert.equal(moneyOf(state)?.net, 9447.75); // 117 × 85 − 5%
  assert.equal(state.responsibility?.role, "technical_supervisor");

  await assert.rejects(
    queue.decide(enq.id, { outcome: "rejected", reviewerRole: "technical_supervisor", actor: "x" }),
    (e: { status?: number }) => e.status === 409,
  );
  assert.equal(pushes.length, 2);
  assert.equal((pushes[1].payload as { event: string }).event, "decided");
});

test("fencing: a leased case cannot be decided without the lease token", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  await queue.lease({ holder: "a" });
  await assert.rejects(
    queue.decide(enq.id, { outcome: "accepted", reviewerRole: "technical_supervisor", actor: "x" }),
    (e: { status?: number }) => e.status === 409,
  );
});

test("fencing: a stale token is rejected after the case is re-leased", async () => {
  const { queue, advance } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const a = await queue.lease({ holder: "a", leaseSeconds: 60 });
  advance(61); // a's lease expires
  const b = await queue.lease({ holder: "b" });
  assert.notEqual(b!.lease!.fence, a!.lease!.fence);

  await assert.rejects(
    queue.decide(enq.id, { outcome: "accepted", reviewerRole: "technical_supervisor", actor: "a", leaseToken: a!.lease!.token }),
    (e: { status?: number }) => e.status === 409,
  );
  const ok = await queue.decide(enq.id, { outcome: "accepted", reviewerRole: "technical_supervisor", actor: "b", leaseToken: b!.lease!.token });
  assert.equal(ok.item.status, "decided");
});

test("decide is idempotent under a retried idempotency key", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const leased = await queue.lease({ holder: "a" });
  const args = {
    outcome: "accepted" as const,
    reviewerRole: "technical_supervisor",
    actor: "a",
    leaseToken: leased!.lease!.token,
    idempotencyKey: "k1",
  };
  const r1 = await queue.decide(enq.id, args);
  const r2 = await queue.decide(enq.id, args); // retry: first result, no 409, no double-fire
  assert.equal(r2.state.status, "accepted");
  assert.equal(r1.item.id, r2.item.id);
});

test("decide: a wrong-role decision is refused (422); the case stays reviewable", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const leased = await queue.lease();
  await assert.rejects(
    queue.decide(enq.id, { outcome: "accepted", reviewerRole: "contractor", actor: "c", leaseToken: leased!.lease!.token }),
    (e: { status?: number }) => e.status === 422,
  );
  const after = await queue.get(enq.id);
  assert.equal(after?.state.decision, undefined);
});

test("decide: acceptance is refused while blocking checks fail; rework is allowed", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: badEvents });
  assert.equal(enq.state.checksPassed, false);
  await assert.rejects(
    queue.decide(enq.id, { outcome: "accepted", reviewerRole: "technical_supervisor", actor: "s" }),
    (e: { status?: number }) => e.status === 422,
  );
  const { state } = await queue.decide(enq.id, { outcome: "returned_for_rework", reviewerRole: "technical_supervisor", actor: "s" });
  assert.equal(state.status, "returned_for_rework");
});

test("automation: a small in-policy claim auto-decides on enqueue", async () => {
  const { queue } = makeQueue({ webhook: "https://hook.test/notify" });
  const item = await queue.enqueue({ gate, events: smallEvents });
  assert.equal(item.status, "decided");
  assert.equal(item.decidedBy, "system:auto");
  assert.equal(item.state.status, "accepted");
  assert.equal(moneyOf(item.state)?.net, 807.5); // 10 × 85 − 5%
  assert.equal(await queue.lease(), null);
});

test("SLA: an overdue case is escalated by reap() and leased first", async () => {
  const { queue, advance } = makeQueue();
  const slow = await queue.enqueue({ gate, events: pendingEvents, inbox: "supervisors", by: "r" });
  advance(49 * 3600); // past the 48h SLA window
  await queue.enqueue({ gate, events: pendingEvents, inbox: "supervisors", by: "r" }); // a fresh case

  const leased = await queue.lease({ holder: "chief" }); // reap breaches `slow`, sorts it first
  assert.equal(leased?.id, slow.id);

  const after = await queue.get(slow.id);
  assert.ok(after?.breachedAt);
  assert.equal(after?.inbox, "supervisors-escalation");
  assert.ok(after?.assignments.some((a) => a.kind === "escalate" && a.by === "system:sla"));

  const { inboxes } = await queue.listInboxes();
  assert.equal(inboxes.find((i) => i.name === "supervisors-escalation")?.counts.breached, 1);
});

test("attachEvidence: an agent can add grounds to a pending case before deciding", async () => {
  const { queue } = makeQueue();
  // Enqueue with only the claim -> blocking checks fail.
  const enq = await queue.enqueue({ gate, events: [claim(120)] });
  assert.equal(enq.state.checksPassed, false);

  for (const e of fullDocs(120).slice(1)) {
    await queue.attachEvidence(enq.id, e.evidence);
  }
  const ready = await queue.get(enq.id);
  assert.equal(ready?.state.checksPassed, true); // survey 120 vs claim 120 etc.
});

test("lease expiry: an abandoned lease returns to the pool", async () => {
  const { queue, advance } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const first = await queue.lease({ holder: "a", leaseSeconds: 60 });
  assert.equal(await queue.lease({ holder: "b" }), null);
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
  await queue.createInbox({ name: "supervisors", match: { reviewerRole: "technical_supervisor" } });
  const item = await queue.enqueue({ gate, events: pendingEvents });
  assert.equal(item.inbox, "supervisors");
  assert.equal(item.assignments[0].kind, "route");
  assert.equal(item.assignments[0].by, "system:router");
  assert.equal(await queue.lease({ inbox: "logistics" }), null);
  assert.equal((await queue.lease({ inbox: "supervisors", holder: "ivanov" }))?.id, item.id);
});

test("delegation: assign reassigns and appends to the trail; prior entries are untouched", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents, inbox: "intake", by: "router" });
  const firstTrace = enq.assignments[0];
  const reassigned = await queue.assign(enq.id, { inbox: "supervisors", assignee: "ivanov", by: "dispatcher:lena", reason: "Ivanov owns the foundation package" });
  assert.equal(reassigned.inbox, "supervisors");
  assert.equal(reassigned.assignee, "ivanov");
  assert.equal(reassigned.assignments.length, 2);
  assert.deepEqual(reassigned.assignments[0], firstTrace);
  assert.equal(reassigned.assignments[1].kind, "reassign");
  assert.equal(reassigned.assignments[1].fromInbox, "intake");
});

test("delegation: a trace must name its author and a destination", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  await assert.rejects(
    // @ts-expect-error — 'by' is required
    queue.assign(enq.id, { inbox: "supervisors" }),
    (e: { status?: number }) => e.status === 400,
  );
  await assert.rejects(queue.assign(enq.id, { by: "dispatcher" }), (e: { status?: number }) => e.status === 400);
});

test("trace: claim, release and decision all leave entries that survive on the item", async () => {
  const { queue } = makeQueue();
  const enq = await queue.enqueue({ gate, events: pendingEvents, inbox: "supervisors", by: "router" });
  await queue.lease({ inbox: "supervisors", holder: "ivanov" });
  const released = await queue.release(enq.id);
  assert.ok(released.assignments.some((a) => a.kind === "release"));
  const leased = await queue.lease({ inbox: "supervisors", holder: "ivanov" });
  const { item } = await queue.decide(enq.id, { outcome: "accepted", reviewerRole: "technical_supervisor", actor: "ivanov", leaseToken: leased!.lease!.token });
  assert.equal(item.status, "decided");
  assert.deepEqual(item.assignments.map((a) => a.kind), ["route", "claim", "release", "claim"]);
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
