// Transport-agnostic HTTP handler shared by the Vercel function and the Docker
// server. It maps a parsed request to a status + JSON body; it never touches
// sockets, so the same routing runs on serverless and on a long-running server.
//
//   stateless (run anywhere, incl. Vercel):
//     GET  /                 endpoint index
//     GET  /health           liveness + whether the queue is enabled here
//     POST /fold             { gate, events? } -> folded GateState
//     POST /autodecide       { gate, events? } -> { state, autodecision }
//
//   review queue (requires the stateful server; 501 otherwise):
//     POST /queue            enqueue a case            { gate, events?, notify? }
//     POST /queue/lease      lease the next case       { role?, domain?, holder? }
//     GET  /queue            list cases                ?status= &domain=
//     GET  /queue/:id        fetch one case
//     POST /queue/:id/decision   record a decision     { outcome, reviewerRole, actor, leaseToken? }
//     POST /queue/:id/release    hand a lease back     { leaseToken? }

import { autodecide, fold, loadGate } from "./index.ts";
import type { ReviewQueue } from "./queue/queue.ts";
import type { AssignInput, DecisionInput, EnqueueInput } from "./queue/types.ts";

export interface HttpRequest {
  method: string;
  /** Path only (no query string). */
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  /** JSON-serializable body, or null for an empty (204) response. */
  body: unknown;
}

const json = (status: number, body: unknown): HttpResponse => ({ status, body });

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function normalize(path: string): string {
  const p = (path.split("?")[0] || "/").replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

function parseCase(body: unknown): {
  gate?: unknown;
  events?: unknown[];
  error?: string;
} {
  const o = asObject(body);
  if (!o) return { error: "expected a JSON object body" };
  if (!asObject(o.gate)) return { error: "missing 'gate' definition" };
  const scenario = asObject(o.scenario);
  const events = Array.isArray(o.events)
    ? o.events
    : Array.isArray(scenario?.events)
      ? (scenario!.events as unknown[])
      : [];
  return { gate: o.gate, events };
}

function index(hasQueue: boolean): unknown {
  return {
    name: "open-gates",
    engine: "@open-gates/engine",
    queue: hasQueue,
    endpoints: {
      "GET /health": "liveness",
      "POST /fold": "{ gate, events? } -> folded state",
      "POST /autodecide": "{ gate, events? } -> { state, autodecision }",
      ...(hasQueue
        ? {
            "POST /queue": "enqueue a case for review (optionally route to an inbox)",
            "POST /queue/lease": "lease the next matching case (filter by inbox/role/domain)",
            "GET /queue": "list cases (?status= &domain= &inbox= &assignee=)",
            "GET /queue/:id": "fetch one case (incl. its delegation trail)",
            "POST /queue/:id/assign": "delegate a case to an inbox/participant",
            "POST /queue/:id/decision": "record a decision",
            "POST /queue/:id/release": "release a lease",
            "POST /inboxes": "create/register an inbox (with optional routing rule)",
            "GET /inboxes": "list inboxes with case counts",
          }
        : {
            queue:
              "not enabled on this deployment — run the Docker/long-running server (see docs/REVIEW-QUEUE.md)",
          }),
    },
  };
}

/**
 * Build the request handler. Pass a ReviewQueue to enable the stateful queue
 * routes; omit it (e.g. on serverless) to serve only the stateless engine
 * endpoints — queue routes then return 501.
 */
export function createHandler(queue?: ReviewQueue) {
  // Wrap a queue call, mapping a thrown { status } error onto the response.
  async function guard(
    ok: number,
    fn: () => Promise<unknown>,
  ): Promise<HttpResponse> {
    try {
      return json(ok, await fn());
    } catch (e) {
      const status =
        typeof (e as { status?: number }).status === "number"
          ? (e as { status: number }).status
          : 500;
      return json(status, { error: (e as Error).message });
    }
  }

  const queueDisabled = (): HttpResponse =>
    json(501, {
      error:
        "the review queue is not enabled on this deployment; run the Docker/long-running server",
      docs: "docs/REVIEW-QUEUE.md",
    });

  return async function handle(req: HttpRequest): Promise<HttpResponse> {
    const method = req.method.toUpperCase();
    const path = normalize(req.path);
    const seg = path === "/" ? [] : path.slice(1).split("/");

    // ---- stateless engine endpoints --------------------------------------
    if (method === "GET" && path === "/") return json(200, index(!!queue));
    if (method === "GET" && path === "/health") {
      return json(200, { ok: true, engine: "@open-gates/engine", queue: !!queue });
    }
    if (method === "POST" && path === "/fold") {
      const c = parseCase(req.body);
      if (c.error) return json(400, { error: c.error });
      return json(200, fold(loadGate(c.gate), c.events as never));
    }
    if (method === "POST" && path === "/autodecide") {
      const c = parseCase(req.body);
      if (c.error) return json(400, { error: c.error });
      const g = loadGate(c.gate);
      const state = fold(g, c.events as never);
      return json(200, { state, autodecision: autodecide(g, state) });
    }

    // ---- inbox registry (stateful) ---------------------------------------
    if (seg[0] === "inboxes") {
      if (!queue) return queueDisabled();
      if (method === "GET" && seg.length === 1) {
        return json(200, await queue.listInboxes());
      }
      if (method === "POST" && seg.length === 1) {
        const body = asObject(req.body);
        if (!body || !body.name) {
          return json(400, { error: "POST /inboxes requires { name }" });
        }
        return guard(201, () =>
          queue.createInbox(
            body as { name: string; description?: string; match?: never },
          ),
        );
      }
    }

    // ---- review queue (stateful) -----------------------------------------
    if (seg[0] === "queue") {
      if (!queue) return queueDisabled();

      if (method === "POST" && seg.length === 1) {
        const body = asObject(req.body);
        if (!body || !asObject(body.gate)) {
          return json(400, { error: "POST /queue requires { gate, events? }" });
        }
        return guard(201, () => queue.enqueue(body as unknown as EnqueueInput));
      }

      if (method === "POST" && seg.length === 2 && seg[1] === "lease") {
        const item = await queue.lease((asObject(req.body) ?? {}) as never);
        return item ? json(200, item) : json(204, null);
      }

      if (method === "GET" && seg.length === 1) {
        return json(
          200,
          await queue.list({
            status: req.query?.status,
            domain: req.query?.domain,
            inbox: req.query?.inbox,
            assignee: req.query?.assignee,
          }),
        );
      }

      if (method === "GET" && seg.length === 2) {
        const item = await queue.get(seg[1]);
        return item
          ? json(200, item)
          : json(404, { error: `no queue item "${seg[1]}"` });
      }

      if (method === "POST" && seg.length === 3 && seg[2] === "assign") {
        const body = asObject(req.body);
        if (!body) return json(400, { error: "assign requires a JSON body" });
        return guard(200, () =>
          queue.assign(seg[1], body as unknown as AssignInput),
        );
      }

      if (method === "POST" && seg.length === 3 && seg[2] === "decision") {
        const body = asObject(req.body);
        if (!body) return json(400, { error: "decision requires a JSON body" });
        return guard(200, () =>
          queue.decide(seg[1], body as unknown as DecisionInput),
        );
      }

      if (method === "POST" && seg.length === 3 && seg[2] === "release") {
        const body = asObject(req.body) ?? {};
        return guard(200, () =>
          queue.release(seg[1], body.leaseToken as string | undefined),
        );
      }
    }

    return json(404, { error: `no route for ${method} ${path}` });
  };
}
