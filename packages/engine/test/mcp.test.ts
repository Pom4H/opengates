import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatch, DEFAULT_PROTOCOL_VERSION, type DispatchDeps } from "../src/mcp/rpc.ts";
import { TOOLS, callTool } from "../src/mcp/tools.ts";
import { createQueueClient, type HttpResult, type QueueClient } from "../src/mcp/client.ts";

// A fake queue client: each method returns a canned HttpResult so we can test
// the MCP mapping without a running server.
function fakeClient(over: Partial<Record<keyof QueueClient, HttpResult>> = {}): QueueClient {
  const make = (key: keyof QueueClient) =>
    async () => over[key] ?? { status: 200, body: { ok: key } };
  return {
    lease: make("lease"),
    get: make("get"),
    list: make("list"),
    decide: make("decide"),
    release: make("release"),
    enqueue: make("enqueue"),
    inboxes: make("inboxes"),
  };
}

function deps(client: QueueClient): DispatchDeps {
  return {
    serverInfo: { name: "open-gates", version: "0.0.1" },
    instructions: "review cases",
    tools: TOOLS,
    call: (name, args) => callTool(client, name, args),
  };
}

const rpc = (method: string, params?: unknown, id: number | null = 1) => ({
  jsonrpc: "2.0" as const,
  id,
  method,
  params: params as Record<string, unknown>,
});

// ---- protocol --------------------------------------------------------------

test("initialize: echoes the client protocol version and advertises tools", async () => {
  const res = await dispatch(rpc("initialize", { protocolVersion: "2024-11-05" }), deps(fakeClient()));
  assert.ok(res);
  const r = res!.result as any;
  assert.equal(r.protocolVersion, "2024-11-05");
  assert.equal(r.serverInfo.name, "open-gates");
  assert.ok(r.capabilities.tools, "advertises a tools capability");
});

test("initialize: falls back to the default protocol version", async () => {
  const res = await dispatch(rpc("initialize", {}), deps(fakeClient()));
  assert.equal((res!.result as any).protocolVersion, DEFAULT_PROTOCOL_VERSION);
});

test("notifications/initialized gets no reply", async () => {
  // A notification has no id.
  const res = await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" }, deps(fakeClient()));
  assert.equal(res, null);
});

test("ping returns an empty result", async () => {
  const res = await dispatch(rpc("ping"), deps(fakeClient()));
  assert.deepEqual(res!.result, {});
});

test("an unknown method is a -32601 error", async () => {
  const res = await dispatch(rpc("does/not/exist"), deps(fakeClient()));
  assert.equal(res!.error?.code, -32601);
});

// ---- tools -----------------------------------------------------------------

test("tools/list returns the queue tool surface", async () => {
  const res = await dispatch(rpc("tools/list"), deps(fakeClient()));
  const names = (res!.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  for (const expected of [
    "open_gates_lease",
    "open_gates_get",
    "open_gates_list",
    "open_gates_decide",
    "open_gates_release",
    "open_gates_enqueue",
    "open_gates_inboxes",
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
});

test("every tool advertises a valid object inputSchema", () => {
  for (const t of TOOLS) {
    assert.equal((t.inputSchema as any).type, "object", `${t.name} schema is not an object`);
    assert.ok(t.description.length > 20, `${t.name} needs a real description`);
  }
});

test("tools/call lease: a leased case is returned as JSON text", async () => {
  const client = fakeClient({
    lease: { status: 200, body: { id: "case-1", gateId: "construction.x", lease: { token: "tok" } } },
  });
  const res = await dispatch(rpc("tools/call", { name: "open_gates_lease", arguments: {} }), deps(client));
  const r = res!.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.ok(!r.isError);
  assert.match(r.content[0].text, /case-1/);
});

test("tools/call lease: an empty queue (204) is a friendly note, not an error", async () => {
  const client = fakeClient({ lease: { status: 204, body: null } });
  const res = await dispatch(rpc("tools/call", { name: "open_gates_lease", arguments: {} }), deps(client));
  const r = res!.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.ok(!r.isError);
  assert.match(r.content[0].text, /[Nn]o pending/);
});

test("tools/call decide: an HTTP 4xx becomes isError content the model can read", async () => {
  const client = fakeClient({ decide: { status: 403, body: { error: "not authorized for role" } } });
  const res = await dispatch(
    rpc("tools/call", {
      name: "open_gates_decide",
      arguments: { id: "case-1", outcome: "accepted", reviewerRole: "x" },
    }),
    deps(client),
  );
  const r = res!.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /403/);
  assert.match(r.content[0].text, /not authorized/);
});

test("tools/call decide: the id routes the URL and is stripped from the decision body", async () => {
  let seenId: string | undefined;
  let seenBody: Record<string, unknown> | undefined;
  const client = fakeClient();
  client.decide = async (id, body) => {
    seenId = id;
    seenBody = body;
    return { status: 200, body: { item: { id }, state: { status: "accepted" } } };
  };
  await dispatch(
    rpc("tools/call", {
      name: "open_gates_decide",
      arguments: { id: "case-9", outcome: "accepted", reviewerRole: "technical_supervisor", note: "ok" },
    }),
    deps(client),
  );
  assert.equal(seenId, "case-9");
  assert.equal(seenBody!.outcome, "accepted");
  assert.equal(seenBody!.note, "ok");
  // 'id' is the URL path param; it must not also leak into the JSON body.
  assert.ok(!("id" in seenBody!), "id should be stripped from the decision body");
});

test("tools/call: an unknown tool is a tool error, not a protocol crash", async () => {
  const res = await dispatch(rpc("tools/call", { name: "open_gates_nope", arguments: {} }), deps(fakeClient()));
  const r = res!.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /unknown tool/);
});

// ---- client ----------------------------------------------------------------

test("client: forwards the bearer token and builds query strings", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = createQueueClient("http://q.test/", "secret-token", fakeFetch as typeof fetch);

  await client.list({ status: "pending", domain: undefined });
  assert.equal(calls[0].url, "http://q.test/queue?status=pending");
  assert.equal((calls[0].init.headers as Record<string, string>)["authorization"], "Bearer secret-token");
});

test("client: a 204 is normalized to a null body", async () => {
  const fakeFetch = async () => new Response(null, { status: 204 });
  const client = createQueueClient("http://q.test", undefined, fakeFetch as typeof fetch);
  const res = await client.lease({});
  assert.deepEqual(res, { status: 204, body: null });
});
