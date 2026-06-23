// Transport-agnostic HTTP handler shared by the Vercel function and the Docker
// server. It maps a parsed request to a status + JSON body; it never touches
// sockets, so the same routing runs on serverless and on a long-running server.
//
//   stateless (run anywhere, incl. Vercel):
//     GET  /                     endpoint index
//     GET  /health               liveness + whether the queue is enabled here
//     POST /fold                 { gate, events? } -> folded GateState
//     POST /autodecide           { gate, events? } -> { state, autodecision }
//
//   review queue (requires the stateful server; 501 otherwise):
//     POST /queue                enqueue a case
//     POST /queue/lease          lease the next case (breached/priority first)
//     GET  /queue                list cases
//     GET  /queue/:id            fetch one case
//     POST /queue/:id/decision   record a decision
//     POST /queue/:id/release    hand a lease back
//     POST /inboxes  GET /inboxes
//
//   OAuth 2.1 (when auth is configured):
//     GET  /.well-known/oauth-protected-resource   RFC 9728 metadata
//     -> /queue/:id/decision then REQUIRES a Bearer token; the reviewer role and
//        actor are derived from the token's scope, never the request body.

import { authenticate, authorizedRole, type AuthOptions } from "./auth.ts";
import { autodecide, fold, loadGate, normalizeLog } from "./index.ts";
import type { ReviewQueue } from "./queue/queue.ts";
import type { AssignInput, DecisionInput, EnqueueInput } from "./queue/types.ts";

export interface HttpRequest {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface HandlerAuth extends AuthOptions {
  /** This resource's URI (the token audience), advertised in the PRM document. */
  resourceUri: string;
  /** Authorization server issuer URLs for the PRM document. */
  authorizationServers?: string[];
}

export interface HandlerOptions {
  auth?: HandlerAuth;
}

const json = (status: number, body: unknown, headers?: Record<string, string>): HttpResponse => ({ status, body, headers });

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function normalize(path: string): string {
  const p = (path.split("?")[0] || "/").replace(/(.)\/+$/, "$1");
  return p === "" ? "/" : p;
}

function parseCase(body: unknown): { gate?: unknown; events?: unknown[]; error?: string } {
  const o = asObject(body);
  if (!o) return { error: "expected a JSON object body" };
  if (!asObject(o.gate)) return { error: "missing 'gate' definition" };
  const scenario = asObject(o.scenario);
  const events = Array.isArray(o.events) ? o.events : Array.isArray(scenario?.events) ? (scenario!.events as unknown[]) : [];
  return { gate: o.gate, events };
}

function header(req: HttpRequest, name: string): string | undefined {
  const h = req.headers;
  if (!h) return undefined;
  return h[name] ?? h[name.toLowerCase()];
}

function prmDocument(auth: HandlerAuth): unknown {
  return {
    resource: auth.resourceUri,
    authorization_servers: auth.authorizationServers ?? (auth.issuer ? [auth.issuer] : []),
    scopes_supported: ["og:read", "og:enqueue", "og:lease", "og:decide:*"],
    bearer_methods_supported: ["header"],
  };
}

function index(hasQueue: boolean, hasAuth: boolean): unknown {
  return {
    name: "open-gates",
    engine: "@open-gates/engine",
    queue: hasQueue,
    auth: hasAuth ? "oauth2.1" : "none",
    endpoints: {
      "GET /health": "liveness",
      "POST /fold": "{ gate, events? } -> folded state",
      "POST /autodecide": "{ gate, events? } -> { state, autodecision }",
      ...(hasQueue
        ? {
            "POST /queue": "enqueue a case for review",
            "POST /queue/lease": "lease the next case (filter by inbox/role/domain)",
            "GET /queue": "list cases (?status= &domain= &inbox= &assignee=)",
            "GET /queue/:id": "fetch one case (incl. its delegation trail)",
            "POST /queue/:id/evidence": "attach an evidence event and re-fold",
            "POST /queue/:id/assign": "delegate a case to an inbox/participant",
            "POST /queue/:id/decision": hasAuth ? "record a decision (Bearer token; role from scope)" : "record a decision",
            "POST /queue/:id/release": "release a lease",
            "POST /inboxes": "create/register an inbox",
            "GET /inboxes": "list inboxes with case counts",
          }
        : { queue: "not enabled here — run the Docker/long-running server (docs/REVIEW-QUEUE.md)" }),
      ...(hasAuth ? { "GET /.well-known/oauth-protected-resource": "RFC 9728 protected-resource metadata" } : {}),
    },
  };
}

export function createHandler(queue?: ReviewQueue, options: HandlerOptions = {}) {
  const auth = options.auth;

  async function guard(ok: number, fn: () => Promise<unknown>): Promise<HttpResponse> {
    try {
      return json(ok, await fn());
    } catch (e) {
      const err = e as { status?: number; message: string; wwwAuthenticate?: string };
      const status = typeof err.status === "number" ? err.status : 500;
      return json(status, { error: err.message }, err.wwwAuthenticate ? { "WWW-Authenticate": err.wwwAuthenticate } : undefined);
    }
  }

  const queueDisabled = (): HttpResponse =>
    json(501, { error: "the review queue is not enabled on this deployment; run the Docker/long-running server", docs: "docs/REVIEW-QUEUE.md" });

  return async function handle(req: HttpRequest): Promise<HttpResponse> {
    const method = req.method.toUpperCase();
    const path = normalize(req.path);
    const seg = path === "/" ? [] : path.slice(1).split("/");

    // ---- stateless engine endpoints --------------------------------------
    if (method === "GET" && path === "/") return json(200, index(!!queue, !!auth));
    if (method === "GET" && path === "/health") return json(200, { ok: true, engine: "@open-gates/engine", queue: !!queue });
    if (method === "GET" && path === "/.well-known/oauth-protected-resource") {
      return auth ? json(200, prmDocument(auth)) : json(404, { error: "no auth configured on this deployment" });
    }
    if (method === "POST" && path === "/fold") {
      const c = parseCase(req.body);
      if (c.error) return json(400, { error: c.error });
      return json(200, fold(loadGate(c.gate), normalizeLog("fold", (c.events ?? []) as never)));
    }
    if (method === "POST" && path === "/autodecide") {
      const c = parseCase(req.body);
      if (c.error) return json(400, { error: c.error });
      const g = loadGate(c.gate);
      const state = fold(g, normalizeLog("fold", (c.events ?? []) as never));
      const triggerAt = state.decidedAt ?? state.submittedAt ?? new Date(0).toISOString();
      return json(200, { state, autodecision: autodecide(g, state, triggerAt) });
    }

    // ---- inbox registry (stateful) ---------------------------------------
    if (seg[0] === "inboxes") {
      if (!queue) return queueDisabled();
      if (method === "GET" && seg.length === 1) return json(200, await queue.listInboxes());
      if (method === "POST" && seg.length === 1) {
        const body = asObject(req.body);
        if (!body || !body.name) return json(400, { error: "POST /inboxes requires { name }" });
        return guard(201, () => queue.createInbox(body as { name: string; description?: string; match?: never }));
      }
    }

    // ---- review queue (stateful) -----------------------------------------
    if (seg[0] === "queue") {
      if (!queue) return queueDisabled();

      if (method === "POST" && seg.length === 1) {
        const body = asObject(req.body);
        if (!body || !asObject(body.gate)) return json(400, { error: "POST /queue requires { gate, events? }" });
        return guard(201, () => queue.enqueue(body as unknown as EnqueueInput));
      }

      if (method === "POST" && seg.length === 2 && seg[1] === "lease") {
        const item = await queue.lease((asObject(req.body) ?? {}) as never);
        return item ? json(200, item) : json(204, null);
      }

      if (method === "GET" && seg.length === 1) {
        return json(200, await queue.list({ status: req.query?.status, domain: req.query?.domain, inbox: req.query?.inbox, assignee: req.query?.assignee }));
      }

      if (method === "GET" && seg.length === 2) {
        const item = await queue.get(seg[1]);
        return item ? json(200, item) : json(404, { error: `no queue item "${seg[1]}"` });
      }

      if (method === "POST" && seg.length === 3 && seg[2] === "evidence") {
        const body = asObject(req.body);
        if (!body || !asObject(body.evidence)) return json(400, { error: "POST /queue/:id/evidence requires { evidence }" });
        return guard(200, () => queue.attachEvidence(seg[1], body.evidence as never, { actor: body.actor as string | undefined }));
      }

      if (method === "POST" && seg.length === 3 && seg[2] === "assign") {
        const body = asObject(req.body);
        if (!body) return json(400, { error: "assign requires a JSON body" });
        return guard(200, () => queue.assign(seg[1], body as unknown as AssignInput));
      }

      if (method === "POST" && seg.length === 3 && seg[2] === "decision") {
        const body = asObject(req.body);
        if (!body) return json(400, { error: "decision requires a JSON body" });
        const input = { ...(body as unknown as DecisionInput) };

        // Authority is proven, not asserted: derive role + actor from the token.
        if (auth) {
          const item = await queue.get(seg[1]);
          if (!item) return json(404, { error: `no queue item "${seg[1]}"` });
          try {
            const principal = await authenticate(header(req, "authorization"), auth);
            input.reviewerRole = authorizedRole(principal, item.gate.reviewer.role);
            input.actor = principal.sub;
          } catch (e) {
            const err = e as { status?: number; message: string; wwwAuthenticate?: string };
            return json(err.status ?? 401, { error: err.message }, err.wwwAuthenticate ? { "WWW-Authenticate": err.wwwAuthenticate } : undefined);
          }
        }
        const idem = header(req, "idempotency-key");
        if (idem) input.idempotencyKey = idem;
        return guard(200, () => queue.decide(seg[1], input));
      }

      if (method === "POST" && seg.length === 3 && seg[2] === "release") {
        const body = asObject(req.body) ?? {};
        return guard(200, () => queue.release(seg[1], body.leaseToken as string | undefined));
      }
    }

    return json(404, { error: `no route for ${method} ${path}` });
  };
}
