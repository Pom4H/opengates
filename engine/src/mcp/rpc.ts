// A minimal JSON-RPC 2.0 dispatcher for the MCP stdio protocol.
//
// MCP is JSON-RPC over newline-delimited stdio. Rather than pull in an SDK, this
// handles the handful of methods a tools-only server needs — initialize,
// tools/list, tools/call, ping — and treats anything else per spec (notifications
// are ignored; unknown requests get a -32601). `dispatch` is a pure function of
// (message, deps) so it is testable without spawning a process.

import type { ToolResult, ToolSpec } from "./tools.ts";

export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface DispatchDeps {
  serverInfo: { name: string; version: string };
  instructions?: string;
  tools: ToolSpec[];
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

const ok = (id: JsonRpcMessage["id"], result: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result,
});

const err = (
  id: JsonRpcMessage["id"],
  code: number,
  message: string,
): JsonRpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/**
 * Handle one JSON-RPC message. Returns the response to write, or `null` for a
 * notification (a message with no `id`, e.g. `notifications/initialized`), which
 * by the spec gets no reply.
 */
export async function dispatch(
  msg: JsonRpcMessage,
  deps: DispatchDeps,
): Promise<JsonRpcResponse | null> {
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return ok(msg.id, {
        protocolVersion:
          typeof requested === "string" ? requested : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: deps.serverInfo,
        ...(deps.instructions ? { instructions: deps.instructions } : {}),
      });
    }

    case "tools/list":
      return ok(msg.id, { tools: deps.tools });

    case "tools/call": {
      const name = msg.params?.name;
      if (typeof name !== "string") {
        return err(msg.id, -32602, "tools/call requires a string 'name'");
      }
      const args =
        (msg.params?.arguments as Record<string, unknown> | undefined) ?? {};
      const result = await deps.call(name, args);
      return ok(msg.id, result);
    }

    case "ping":
      return ok(msg.id, {});

    default:
      // Notifications (initialized, cancelled, …) need no reply.
      if (isNotification) return null;
      return err(msg.id, -32601, `method not found: ${msg.method ?? "(none)"}`);
  }
}
