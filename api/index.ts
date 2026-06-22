// Vercel Function — the default, one-command path.
//
// A thin adapter over the shared engine handler. Vercel runs this TypeScript
// file directly from /api on the Node.js runtime (Node 22+), no build config
// needed. It serves the STATELESS endpoints (/, /health, /fold, /autodecide);
// the stateful review queue lives in the Docker/long-running server, so queue
// routes here answer 501. vercel.json rewrites every path to this function.

import { createHandler } from "../engine/src/http.ts";

const handle = createHandler(); // no queue on serverless

async function run(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Requests may arrive as "/fold" (rewritten) or "/api/fold" (direct).
  let path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) {
    path = path.slice(4) || "/";
  }

  let body: unknown;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
  }

  const result = await handle({
    method: request.method,
    path,
    query: Object.fromEntries(url.searchParams),
    body,
  });

  if (result.body === null) return new Response(null, { status: result.status });
  return Response.json(result.body, { status: result.status });
}

export function GET(request: Request): Promise<Response> {
  return run(request);
}
export function POST(request: Request): Promise<Response> {
  return run(request);
}
