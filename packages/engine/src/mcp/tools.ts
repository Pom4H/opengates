// The MCP tool surface for the Open Gates review queue.
//
// Each tool maps one queue HTTP route to an MCP tool a Claude (or any MCP
// client) can call directly — no curl, no hand-built lease tokens. The tools
// mirror the reviewer loop the /review-gate skill documents: lease -> judge ->
// decide, plus the supporting list/get/release/enqueue/inboxes operations.

import type { QueueClient, HttpResult } from "./client.ts";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });
const fail = (s: string): ToolResult => ({ content: [{ type: "text", text: s }], isError: true });

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const str = (description: string) => ({ type: "string", description });

const OUTCOMES = ["accepted", "accepted_with_exceptions", "rejected", "returned_for_rework"];

export const TOOLS: ToolSpec[] = [
  {
    name: "open_gates_lease",
    description:
      "Pull (lease) the next pending case to review, optionally scoped by inbox, reviewer role or domain. Returns the case (gate, events, folded state, allowedDecisions, lease.token) or a note when nothing is pending. Hold the returned lease.token to decide or release.",
    inputSchema: obj({
      inbox: str("Only lease cases in this inbox."),
      role: str("Only lease cases whose gate reviewer role matches this."),
      domain: str("Only lease cases in this gate domain."),
      holder: str("Reviewer id taking the case (recorded as the lease holder)."),
    }),
  },
  {
    name: "open_gates_get",
    description: "Fetch one case by id, including its folded state and the full delegation trail.",
    inputSchema: obj({ id: str("The case id.") }, ["id"]),
  },
  {
    name: "open_gates_list",
    description: "List cases, optionally filtered by queue status (pending/leased/decided), domain, inbox or assignee.",
    inputSchema: obj({
      status: str("pending | leased | decided"),
      domain: str("Gate domain filter."),
      inbox: str("Inbox filter."),
      assignee: str("Assignee filter."),
    }),
  },
  {
    name: "open_gates_decide",
    description:
      "Record a decision on a case. The outcome must be one of the gate's allowedDecisions, and reviewerRole must be the gate's reviewer.role. A positive outcome (accepted / accepted_with_exceptions) needs every blocking check to pass — otherwise the engine refuses it (422); prefer returned_for_rework or release the case instead. Always put your reasoning in note; it is recorded in the audit trail and dataset label.",
    inputSchema: obj(
      {
        id: str("The case id."),
        outcome: { type: "string", enum: OUTCOMES, description: "The decision outcome." },
        reviewerRole: str("Must equal the gate's reviewer.role."),
        actor: str("Reviewer id (ignored when the deployment authenticates the token subject)."),
        note: str("Why — recorded in the audit trail and dataset label."),
        leaseToken: str("The lease.token from open_gates_lease (required if the case is leased)."),
      },
      ["id", "outcome", "reviewerRole"],
    ),
  },
  {
    name: "open_gates_release",
    description: "Hand a leased case back to the pool without deciding (e.g. evidence is insufficient to judge).",
    inputSchema: obj(
      { id: str("The case id."), leaseToken: str("The lease.token to release.") },
      ["id"],
    ),
  },
  {
    name: "open_gates_enqueue",
    description: "Push a new case onto the queue (producer side): a gate definition plus its event log (claim + evidence). Optionally route it to an inbox.",
    inputSchema: obj(
      {
        gate: { type: "object", description: "The gate definition.", additionalProperties: true },
        events: { type: "array", description: "The case event log (claim.submitted, evidence.attached).", items: { type: "object", additionalProperties: true } },
        inbox: str("Route the new case straight to this inbox."),
        notify: str("Per-case webhook URL fired on enqueue/decide."),
      },
      ["gate"],
    ),
  },
  {
    name: "open_gates_inboxes",
    description: "List inboxes with their pending/leased/decided/total case counts, plus the unassigned total.",
    inputSchema: obj({}),
  },
];

/** Map an HTTP result onto an MCP tool result (text payload, isError on failure). */
function fromHttp(res: HttpResult, emptyNote: string): ToolResult {
  if (res.status === 204) return text(emptyNote);
  if (res.status >= 400) {
    const msg = (res.body as { error?: string })?.error ?? "request failed";
    return fail(`HTTP ${res.status}: ${msg}`);
  }
  return text(JSON.stringify(res.body, null, 2));
}

const string = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Dispatch one tool call against the queue client. */
export async function callTool(
  client: QueueClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "open_gates_lease":
        return fromHttp(await client.lease(args), "No pending cases match — nothing to review.");
      case "open_gates_get": {
        const id = string(args.id);
        if (!id) return fail("open_gates_get requires an 'id'.");
        return fromHttp(await client.get(id), "");
      }
      case "open_gates_list":
        return fromHttp(
          await client.list({
            status: string(args.status),
            domain: string(args.domain),
            inbox: string(args.inbox),
            assignee: string(args.assignee),
          }),
          "",
        );
      case "open_gates_decide": {
        const id = string(args.id);
        if (!id) return fail("open_gates_decide requires an 'id'.");
        const { id: _omit, ...body } = args;
        return fromHttp(await client.decide(id, body), "");
      }
      case "open_gates_release": {
        const id = string(args.id);
        if (!id) return fail("open_gates_release requires an 'id'.");
        return fromHttp(await client.release(id, { leaseToken: args.leaseToken }), "");
      }
      case "open_gates_enqueue":
        return fromHttp(await client.enqueue(args), "");
      case "open_gates_inboxes":
        return fromHttp(await client.inboxes(), "");
      default:
        return fail(`unknown tool: ${name}`);
    }
  } catch (err) {
    // A transport failure (queue unreachable) surfaces as a tool error, not a
    // protocol crash, so the model can report it and retry.
    return fail(`tool "${name}" failed: ${(err as Error).message}`);
  }
}
