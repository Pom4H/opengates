// Open Gates MCP server.
//
// Exposes the acceptance-gate lifecycle as typed MCP tools and resources, backed
// by the same ReviewQueue the HTTP server uses. Run it over stdio for a local
// agent (e.g. Claude Code), or mount the same tools behind a remote Streamable
// HTTP transport protected by OAuth 2.1 (see docs/MCP.md).
//
//   npm install        # in this mcp/ folder (the SDK + zod live here only)
//   npm run mcp        # from the repo root (stdio)
//
// Env:
//   QUEUE_FILE   path to the durable queue (default ./data/queue.json)
//   OG_ACTOR     this agent's subject id        (default mcp:local)
//   OG_SCOPES    the agent's granted scopes, space-separated. Decisions need
//                og:decide:<reviewer-role>. Default: og:read og:enqueue og:lease
//                (i.e. it can produce and review, but cannot DECIDE until granted
//                a decide scope) — authority is never self-asserted.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Principal } from "../engine/src/auth.ts";
import { createReviewQueue } from "../engine/src/queue/queue.ts";
import { createFileStore } from "../engine/src/queue/store.ts";
import { registerResources } from "./resources.ts";
import { registerTools } from "./tools.ts";

const queue = createReviewQueue({
  store: createFileStore(process.env.QUEUE_FILE ?? "./data/queue.json"),
  webhook: process.env.OPEN_GATES_WEBHOOK,
});
await queue.ready();

const principal: Principal = {
  sub: process.env.OG_ACTOR ?? "mcp:local",
  scopes: (process.env.OG_SCOPES ?? "og:read og:enqueue og:lease").split(" ").filter(Boolean),
};

const server = new McpServer({ name: "open-gates", version: "0.1.0" });
registerTools(server, queue, principal);
registerResources(server, queue);

await server.connect(new StdioServerTransport());
