import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadGate, type GateDefinition, type GateEvent } from "../src/index.ts";
import { createReviewQueue } from "../src/queue/queue.ts";
import { createMemoryStore } from "../src/queue/store.ts";
import { createHandler, type HttpResponse } from "../src/http.ts";
import { createAuthenticator, signToken, verifyToken } from "../src/queue/auth.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(here + rel, "utf8"));

const gate: GateDefinition = loadGate(read("../../examples/construction/gate.json"));
const accept = read("../../examples/construction/scenario.accept.json");
// A real case awaiting a reviewer: claim + evidence, no decision yet. At 10200
// EUR it is above the auto-accept ceiling, so it stays pending for a human.
const pendingEvents: GateEvent[] = accept.events.slice(0, -1);

const SECRET = "test-secret";
const body = <T>(res: HttpResponse) => res.body as T;

// ---- token primitive -------------------------------------------------------

test("token: sign/verify round-trips the subject and roles", () => {
  const t = signToken(SECRET, { sub: "supervisor:ivanov", roles: ["technical_supervisor"] });
  assert.deepEqual(verifyToken(SECRET, t), {
    sub: "supervisor:ivanov",
    roles: ["technical_supervisor"],
  });
});

test("token: a tampered payload fails verification", () => {
  const t = signToken(SECRET, { sub: "alice", roles: ["technical_supervisor"] });
  const [v, , sig] = t.split(".");
  const forged = Buffer.from(
    JSON.stringify({ sub: "mallory", roles: ["technical_supervisor"] }),
  ).toString("base64url");
  assert.equal(verifyToken(SECRET, `${v}.${forged}.${sig}`), null);
});

test("token: the wrong secret fails verification", () => {
  const t = signToken(SECRET, { sub: "alice", roles: [] });
  assert.equal(verifyToken("another-secret", t), null);
});

test("token: an expired token is rejected", () => {
  const expired = Math.floor(Date.parse("2020-01-01T00:00:00Z") / 1000);
  const t = signToken(SECRET, { sub: "alice", roles: [], exp: expired });
  assert.equal(verifyToken(SECRET, t), null);
  // ...but valid while unexpired (verified against a fixed clock).
  const future = Math.floor(Date.parse("2999-01-01T00:00:00Z") / 1000);
  const live = signToken(SECRET, { sub: "alice", roles: [], exp: future });
  assert.ok(verifyToken(SECRET, live, () => new Date("2026-01-01T00:00:00Z")));
});

// ---- HTTP enforcement ------------------------------------------------------

function setup() {
  const queue = createReviewQueue({ store: createMemoryStore() });
  const handle = createHandler(queue, createAuthenticator(SECRET));
  return { queue, handle };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

test("auth: the stateless fold endpoint stays public", async () => {
  const { handle } = setup();
  const res = await handle({ method: "POST", path: "/fold", body: { gate, events: pendingEvents } });
  assert.equal(res.status, 200);
});

test("auth: a queue route without a token is 401", async () => {
  const { handle } = setup();
  const res = await handle({ method: "POST", path: "/queue/lease", body: {} });
  assert.equal(res.status, 401);
});

test("auth: an invalid token is 401", async () => {
  const { handle } = setup();
  const res = await handle({
    method: "POST",
    path: "/queue/lease",
    headers: auth("v1.garbage.nope"),
    body: {},
  });
  assert.equal(res.status, 401);
});

test("auth: a valid token leases, and the holder is the token subject (not a spoof)", async () => {
  const { queue, handle } = setup();
  await queue.enqueue({ gate, events: pendingEvents });
  const token = signToken(SECRET, { sub: "claude", roles: ["technical_supervisor"] });

  const res = await handle({
    method: "POST",
    path: "/queue/lease",
    headers: auth(token),
    body: { holder: "someone-else" }, // ignored: the token holds the lease
  });
  assert.equal(res.status, 200);
  assert.equal(body<{ lease: { holder: string } }>(res).lease.holder, "claude");
});

test("auth: deciding as a role the token lacks is 403", async () => {
  const { queue, handle } = setup();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const token = signToken(SECRET, { sub: "mallory", roles: ["contractor"] });

  const res = await handle({
    method: "POST",
    path: `/queue/${enq.id}/decision`,
    headers: auth(token),
    body: { outcome: "accepted", reviewerRole: "technical_supervisor" },
  });
  assert.equal(res.status, 403);
});

test("auth: the recorded decider is the token subject, never a spoofed actor", async () => {
  const { queue, handle } = setup();
  const enq = await queue.enqueue({ gate, events: pendingEvents });
  const token = signToken(SECRET, {
    sub: "supervisor:ivanov",
    roles: ["technical_supervisor"],
  });

  const res = await handle({
    method: "POST",
    path: `/queue/${enq.id}/decision`,
    headers: auth(token),
    body: {
      outcome: "accepted",
      reviewerRole: "technical_supervisor",
      actor: "ceo:bigboss", // spoof attempt: must be overridden by the token
      note: "within tolerance",
    },
  });
  assert.equal(res.status, 200);
  const r = body<{ item: { decidedBy: string }; state: { decision: { by: string } } }>(res);
  assert.equal(r.item.decidedBy, "supervisor:ivanov");
  assert.equal(r.state.decision.by, "supervisor:ivanov");
});

test("auth: when no secret is configured, the queue stays open (unchanged behavior)", async () => {
  const queue = createReviewQueue({ store: createMemoryStore() });
  const handle = createHandler(queue, createAuthenticator(undefined));
  await queue.enqueue({ gate, events: pendingEvents });

  const res = await handle({ method: "POST", path: "/queue/lease", body: { holder: "anon" } });
  assert.equal(res.status, 200);
  assert.equal(body<{ lease: { holder: string } }>(res).lease.holder, "anon");
});
