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
//      OPEN_GATES_WEBHOOK (optional push target on enqueue/decide),
//      OPEN_GATES_SECRET (optional — when set, queue routes require a bearer token).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHandler } from "./engine/src/http.ts";
import { createAuthenticator } from "./engine/src/queue/auth.ts";
import { createReviewQueue } from "./engine/src/queue/queue.ts";
import { createFileStore } from "./engine/src/queue/store.ts";

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

const auth = createAuthenticator(process.env.OPEN_GATES_SECRET);
const handle = createHandler(queue, auth);

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
    send(req, res, result.status, result.body, url, started);
  } catch (err) {
    send(req, res, 500, { error: (err as Error).message }, url, started);
  }
});

server.listen(PORT, () => {
  console.log(
    `open-gates review queue listening on :${PORT}  (queue file: ${QUEUE_FILE})`,
  );
  console.log(
    auth.enabled
      ? "auth: ON — queue routes require a bearer token (OPEN_GATES_SECRET set)"
      : "auth: OFF — set OPEN_GATES_SECRET to require reviewer tokens",
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
): void {
  const payload = body === null ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
  console.log(
    `${new Date().toISOString()} ${req.method} ${url.pathname} -> ${status} (${Date.now() - started}ms)`,
  );
}
