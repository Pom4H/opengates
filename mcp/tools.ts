// Open Gates MCP tools.
//
// Each tool is a typed entry point an agent can call. The two stateless tools
// (og_fold, og_autodecide) need no queue; the rest drive a ReviewQueue.
//
// AUTHORITY IS NOT AN ARGUMENT. og_record_decision does NOT take reviewerRole or
// actor — both are derived from the caller's verified scope (a Principal). In
// stdio mode the Principal is the process's granted scopes; over remote
// Streamable HTTP it comes from the OAuth 2.1 token. An agent cannot decide a
// gate whose reviewer.role it lacks `og:decide:<role>` for.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authorizedRole, requireScope, type Principal } from "../engine/src/auth.ts";
import { autodecide, fold, loadGate, normalizeLog } from "../engine/src/index.ts";
import type { ReviewQueue } from "../engine/src/queue/queue.ts";

const OUTCOME = z.enum(["accepted", "accepted_with_exceptions", "rejected", "returned_for_rework"]);

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> });

export function registerTools(server: McpServer, queue: ReviewQueue, principal: Principal): void {
  // --- stateless engine ---
  server.tool(
    "og_fold",
    "Fold a gate definition + an event log into the current acceptance state (status, checks, decision, consequences, dataset label). Pure; no side effects.",
    { gate: z.record(z.any()), events: z.array(z.record(z.any())).optional() },
    async ({ gate, events }) => ok(fold(loadGate(gate), normalizeLog("fold", (events ?? []) as never))),
  );

  server.tool(
    "og_autodecide",
    "Fold a case and report what the gate's automation policy would decide (or null if a human is still required).",
    { gate: z.record(z.any()), events: z.array(z.record(z.any())).optional(), now: z.string().describe("ISO trigger time").optional() },
    async ({ gate, events, now }) => {
      const g = loadGate(gate);
      const state = fold(g, normalizeLog("fold", (events ?? []) as never));
      const at = now ?? state.submittedAt ?? new Date(0).toISOString();
      return ok({ state, autodecision: autodecide(g, state, at) });
    },
  );

  // --- queue: produce / route ---
  server.tool(
    "og_enqueue",
    "Push a case (gate + claim/evidence events) onto the review queue. Optionally route it to an inbox.",
    { gate: z.record(z.any()), events: z.array(z.record(z.any())).optional(), inbox: z.string().optional() },
    async ({ gate, events, inbox }) => {
      requireScope(principal, "og:enqueue");
      return ok(await queue.enqueue({ gate: loadGate(gate), events: events as never, inbox, by: principal.sub }));
    },
  );

  server.tool(
    "og_attach_evidence",
    "Attach an evidence (grounds) event to a pending case, then re-fold it.",
    { caseId: z.string(), evidence: z.object({ kind: z.string(), values: z.record(z.any()).optional(), ref: z.string().optional() }) },
    async ({ caseId, evidence }) => {
      requireScope(principal, "og:enqueue");
      return ok(await queue.attachEvidence(caseId, evidence as never, { actor: principal.sub }));
    },
  );

  // --- queue: review ---
  server.tool(
    "og_lease_next",
    "Lease the next case to review (most overdue / highest priority first), under a fencing token.",
    { inbox: z.string().optional(), role: z.string().optional(), domain: z.string().optional() },
    async ({ inbox, role, domain }) => {
      requireScope(principal, "og:lease");
      const item = await queue.lease({ inbox, role, domain, holder: principal.sub });
      return ok(item ?? { leased: null, reason: "no matching case available" });
    },
  );

  server.tool(
    "og_record_decision",
    "Record a decision on a leased case. The reviewer role and actor are derived from your authenticated scope — NOT passed here. A positive outcome with failing blocking checks is refused by the engine.",
    {
      caseId: z.string(),
      outcome: OUTCOME,
      acceptedValues: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe("Quantities you accept (e.g. surveyed 117, not claimed 120)."),
      note: z.string().optional(),
      leaseToken: z.string().optional(),
      idempotencyKey: z.string().optional(),
    },
    async ({ caseId, outcome, acceptedValues, note, leaseToken, idempotencyKey }) => {
      const item = await queue.get(caseId);
      if (!item) throw new Error(`no case "${caseId}"`);
      const role = authorizedRole(principal, item.gate.reviewer.role); // proven, not asserted
      const result = await queue.decide(caseId, { outcome, acceptedValues, note, leaseToken, idempotencyKey, reviewerRole: role, actor: principal.sub });
      return ok(result);
    },
  );

  server.tool(
    "og_release",
    "Release a leased case back to the queue without deciding.",
    { caseId: z.string(), leaseToken: z.string().optional() },
    async ({ caseId, leaseToken }) => ok(await queue.release(caseId, leaseToken)),
  );

  server.tool(
    "og_list_cases",
    "List queue cases, optionally filtered by status / domain / inbox.",
    { status: z.string().optional(), domain: z.string().optional(), inbox: z.string().optional() },
    async ({ status, domain, inbox }) => {
      requireScope(principal, "og:read");
      return ok(await queue.list({ status, domain, inbox }));
    },
  );
}
