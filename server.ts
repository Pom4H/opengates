// Open Gates review-queue server — the advanced / self-host path.
//
// A dependency-free long-running HTTP server (node:http only) that hosts both
// the stateless engine endpoints and the stateful review queue, backed by a
// file on disk. Mount a volume at QUEUE_FILE's directory to persist the queue.
//
//   node server.ts                       # local
//   docker compose up                    # container (see docker-compose.yml)
//
// Env: PORT (3000), QUEUE_FILE (./data/queue.json), LEASE_SECONDS (300),
//      OPEN_GATES_WEBHOOK (optional push target on enqueue/decide).
//      OAuth 2.1 (optional): set OG_JWT_SECRET to protect decisions — then
//      /queue/:id/decision requires a Bearer token whose og:decide:<role> scope
//      proves the reviewer role. OG_RESOURCE_URI / OG_ISSUER bind the audience
//      and issuer and feed the /.well-known/oauth-protected-resource document.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHandler, type HandlerAuth } from "./packages/engine/src/http.ts";
import { createReviewQueue } from "./packages/engine/src/queue/queue.ts";
import { createFileStore } from "./packages/engine/src/queue/store.ts";

const PORT = Number(process.env.PORT ?? 3000);
const QUEUE_FILE = process.env.QUEUE_FILE ?? "./data/queue.json";
const LEASE_SECONDS = Number(process.env.LEASE_SECONDS ?? 300);
const WEBHOOK = process.env.OPEN_GATES_WEBHOOK;

const queue = createReviewQueue({
  store: createFileStore(QUEUE_FILE),
  leaseSeconds: LEASE_SECONDS,
  webhook: WEBHOOK,
});
await queue.ready();

const auth: HandlerAuth | undefined = process.env.OG_JWT_SECRET
  ? {
      secret: process.env.OG_JWT_SECRET,
      audience: process.env.OG_RESOURCE_URI,
      issuer: process.env.OG_ISSUER,
      resourceUri: process.env.OG_RESOURCE_URI ?? `http://localhost:${PORT}`,
    }
  : undefined;

const handle = createHandler(queue, { auth });

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", "http://localhost");

  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return send(req, res, 400, { error: "invalid JSON body" }, url, started);
  }

  try {
    const result = await handle({
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers as Record<string, string | undefined>,
      body,
    });
    send(req, res, result.status, result.body, url, started, result.headers);
  } catch (err) {
    send(req, res, 500, { error: (err as Error).message }, url, started);
  }
});

server.listen(PORT, () => {
  console.log(
    `open-gates review queue listening on :${PORT}  (queue file: ${QUEUE_FILE})`,
  );
});

// Graceful shutdown so in-flight writes finish before the container stops.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} received — closing server`);
    server.close(() => process.exit(0));
  });
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  url: URL,
  started: number,
  headers?: Record<string, string>,
): void {
  const payload = body === null ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(payload);
  console.log(
    `${new Date().toISOString()} ${req.method} ${url.pathname} -> ${status} (${Date.now() - started}ms)`,
  );
}
