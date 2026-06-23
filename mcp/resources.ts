// Open Gates MCP resources.
//
// Resources expose engine state for an agent to read before it acts:
//   og://case/{id}            folded state + delegation trail
//   og://case/{id}/events     the append-only event log (JSON)
//   og://dataset/{name}       accumulated features->label records (JSON Lines)

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { collectLabels, toJsonl } from "../engine/src/index.ts";
import type { ReviewQueue } from "../engine/src/queue/queue.ts";

export function registerResources(server: McpServer, queue: ReviewQueue): void {
  server.resource(
    "case",
    new ResourceTemplate("og://case/{id}", { list: undefined }),
    async (uri, { id }) => {
      const item = await queue.get(String(id));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(item ?? { error: `no case ${id}` }, null, 2) }] };
    },
  );

  server.resource(
    "case-events",
    new ResourceTemplate("og://case/{id}/events", { list: undefined }),
    async (uri, { id }) => {
      const item = await queue.get(String(id));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(item?.events ?? [], null, 2) }] };
    },
  );

  server.resource(
    "dataset",
    new ResourceTemplate("og://dataset/{name}", { list: undefined }),
    async (uri, { name }) => {
      const cases = await queue.list({ status: "decided" });
      const labels = collectLabels(cases.map((c) => c.state)).filter((r) => r.dataset === String(name));
      return { contents: [{ uri: uri.href, mimeType: "application/x-ndjson", text: toJsonl(labels) }] };
    },
  );
}
