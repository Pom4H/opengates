// A thin HTTP client for the Open Gates review queue.
//
// The MCP server is a *wrapper*, not a second implementation: it speaks to a
// running queue (server.ts or the Docker container) over the same HTTP contract
// a curl reviewer would use. Keeping it a client means the queue stays the one
// source of truth — leases, the delegation trail and persistence all live there.

export interface HttpResult {
  status: number;
  body: unknown;
}

export interface QueueClient {
  lease(args: Record<string, unknown>): Promise<HttpResult>;
  get(id: string): Promise<HttpResult>;
  list(query: Record<string, string | undefined>): Promise<HttpResult>;
  decide(id: string, body: Record<string, unknown>): Promise<HttpResult>;
  release(id: string, body: Record<string, unknown>): Promise<HttpResult>;
  enqueue(body: Record<string, unknown>): Promise<HttpResult>;
  inboxes(): Promise<HttpResult>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Build a queue client bound to a base URL. If `token` is set it is sent as a
 * bearer credential on every call, so the wrapper works against a deployment
 * that requires reviewer auth. `fetchImpl` is injectable for tests.
 */
export function createQueueClient(
  baseUrl: string,
  token?: string,
  fetchImpl: FetchLike = fetch,
): QueueClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers["authorization"] = `Bearer ${token}`;

    const res = await fetchImpl(base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return { status: 204, body: null };
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: data };
  }

  function qs(query: Record<string, string | undefined>): string {
    const pairs = Object.entries(query).filter(
      (e): e is [string, string] => e[1] !== undefined && e[1] !== "",
    );
    return pairs.length
      ? "?" + new URLSearchParams(pairs).toString()
      : "";
  }

  return {
    lease: (args) => request("POST", "/queue/lease", args),
    get: (id) => request("GET", `/queue/${encodeURIComponent(id)}`),
    list: (query) => request("GET", "/queue" + qs(query)),
    decide: (id, body) => request("POST", `/queue/${encodeURIComponent(id)}/decision`, body),
    release: (id, body) => request("POST", `/queue/${encodeURIComponent(id)}/release`, body),
    enqueue: (body) => request("POST", "/queue", body),
    inboxes: () => request("GET", "/inboxes"),
  };
}
