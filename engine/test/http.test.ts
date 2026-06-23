import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

import { createHandler, type HttpRequest } from "../src/http.ts";
import { createReviewQueue } from "../src/queue/queue.ts";
import { createMemoryStore } from "../src/queue/store.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(here + rel, "utf8"));
const gate = read("../../examples/construction/gate.json");
const accept = read("../../examples/construction/scenario.accept.json");
const pending = accept.events.slice(0, -1);

const SECRET = "test-secret";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(scope: string, sub = "agent:1") {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, scope, aud: "https://gates.test", iss: "https://auth.test", exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

function authedHandler() {
  const queue = createReviewQueue({ store: createMemoryStore(), autoDecide: false });
  return createHandler(queue, { auth: { secret: SECRET, audience: "https://gates.test", issuer: "https://auth.test", resourceUri: "https://gates.test" } });
}

test("stateless /fold normalizes raw client events and folds them", async () => {
  const h = createHandler();
  const res = await h({ method: "POST", path: "/fold", body: { gate, events: accept.events } } as HttpRequest);
  assert.equal(res.status, 200);
  assert.equal((res.body as { status: string }).status, "accepted");
});

test("/.well-known/oauth-protected-resource serves PRM only when auth is configured", async () => {
  assert.equal((await createHandler()({ method: "GET", path: "/.well-known/oauth-protected-resource" })).status, 404);
  const res = await authedHandler()({ method: "GET", path: "/.well-known/oauth-protected-resource" });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((res.body as { scopes_supported: string[] }).scopes_supported));
});

test("a decision without a token is 401 with a WWW-Authenticate challenge", async () => {
  const h = authedHandler();
  const enq = await h({ method: "POST", path: "/queue", body: { gate, events: pending } });
  const id = (enq.body as { id: string }).id;
  const res = await h({ method: "POST", path: `/queue/${id}/decision`, body: { outcome: "accepted" } });
  assert.equal(res.status, 401);
  assert.match(res.headers?.["WWW-Authenticate"] ?? "", /Bearer/);
});

test("a scoped token decides; role and actor come from the token, not the body", async () => {
  const h = authedHandler();
  const enq = await h({ method: "POST", path: "/queue", body: { gate, events: pending } });
  const id = (enq.body as { id: string }).id;
  const res = await h({
    method: "POST",
    path: `/queue/${id}/decision`,
    headers: { authorization: `Bearer ${jwt("og:decide:technical_supervisor", "agent:7")}` },
    body: { outcome: "accepted", acceptedValues: { quantity: 117 } },
  });
  assert.equal(res.status, 200);
  const out = res.body as { item: { decidedBy: string }; state: { status: string } };
  assert.equal(out.state.status, "accepted");
  assert.equal(out.item.decidedBy, "agent:7"); // token subject, not a body field
});

test("a token lacking og:decide:<role> is forbidden (403)", async () => {
  const h = authedHandler();
  const enq = await h({ method: "POST", path: "/queue", body: { gate, events: pending } });
  const id = (enq.body as { id: string }).id;
  const res = await h({
    method: "POST",
    path: `/queue/${id}/decision`,
    headers: { authorization: `Bearer ${jwt("og:lease", "agent:8")}` },
    body: { outcome: "accepted" },
  });
  assert.equal(res.status, 403);
});
