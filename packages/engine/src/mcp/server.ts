// Open Gates review-queue MCP server (stdio).
//
// A dependency-free Model Context Protocol server that exposes the review queue
// as tools, so Claude (or any MCP client) can lease -> judge -> decide cases
// natively — no curl, no hand-built lease tokens. It is a thin wrapper over a
// running queue (server.ts / the Docker container) reached over HTTP.
//
//   OPEN_GATES_URL=http://localhost:3000 node packages/engine/src/mcp/server.ts
//
// Register it with Claude Code (see docs/MCP.md):
//   claude mcp add open-gates -- node /abs/path/packages/engine/src/mcp/server.ts
//
// Env: OPEN_GATES_URL (http://localhost:3000),
//      OPEN_GATES_TOKEN (optional bearer token if the deployment requires auth).
//
// Protocol framing: JSON-RPC 2.0, one message per line, on stdin/stdout.
// Diagnostics go to stderr so stdout stays a clean protocol stream.

import { createInterface } from "node:readline";
import { createQueueClient } from "./client.ts";
import { dispatch, type JsonRpcMessage } from "./rpc.ts";
import { TOOLS, callTool } from "./tools.ts";

const BASE = process.env.OPEN_GATES_URL ?? "http://localhost:3000";
const TOKEN = process.env.OPEN_GATES_TOKEN;

const client = createQueueClient(BASE, TOKEN);

const deps = {
  serverInfo: { name: "open-gates", version: "0.0.1" },
  instructions:
    "Review Open Gates acceptance cases. Lease the next case with open_gates_lease, " +
    "judge it from state.checks / claim / evidence (the cross_check is usually decisive), " +
    "then open_gates_decide with an outcome from allowedDecisions and the gate's reviewer.role, " +
    "echoing the lease.token. Never invent evidence; if you cannot judge, prefer " +
    "returned_for_rework or open_gates_release.",
  tools: TOOLS,
  call: (name: string, args: Record<string, unknown>) => callTool(client, name, args),
};

function write(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;

  let msg: JsonRpcMessage;
  try {
    msg = JSON.parse(t);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }

  dispatch(msg, deps)
    .then((res) => {
      if (res) write(res);
    })
    .catch((e: unknown) => {
      write({
        jsonrpc: "2.0",
        id: msg.id ?? null,
        error: { code: -32603, message: (e as Error)?.message ?? String(e) },
      });
    });
});

process.stderr.write(`open-gates MCP server on stdio -> ${BASE}${TOKEN ? " (auth)" : ""}\n`);
