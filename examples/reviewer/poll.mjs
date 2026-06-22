// A dependency-free reference reviewer harness for the Open Gates review queue.
//
// It shows the pull -> review -> decide contract that ANY harness follows —
// Claude (see ../../.claude/skills/review-gate), another agent, or a human UI
// would simply replace `review()` with real judgment. Here the stand-in uses
// the engine's own deterministic check result.
//
//   node examples/reviewer/poll.mjs
//
// Env: OPEN_GATES_URL (http://localhost:3000), REVIEWER id, POLL_MS (2000),
//      OPEN_GATES_TOKEN (optional — bearer token if the deployment requires auth;
//      when set, the server records the token's subject as the decider).

const BASE = process.env.OPEN_GATES_URL ?? "http://localhost:3000";
const REVIEWER = process.env.REVIEWER ?? "reviewer:poller";
const POLL_MS = Number(process.env.POLL_MS ?? 2000);
const TOKEN = process.env.OPEN_GATES_TOKEN;

async function api(method, path, body) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (TOKEN) headers["authorization"] = `Bearer ${TOKEN}`;
  const res = await fetch(BASE + path, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? res.statusText), { status: res.status });
  }
  return data;
}

/**
 * Decide a single case. THIS is the part a real harness owns. A Claude harness
 * reads the claim, evidence and check results and applies judgment; this demo
 * defers to the engine's deterministic checks.
 */
function review(item) {
  const role = item.gate.reviewer.role;
  if (item.state.checksPassed) {
    return { outcome: "accepted", reviewerRole: role, actor: REVIEWER, note: "checks passed" };
  }
  return {
    outcome: "returned_for_rework",
    reviewerRole: role,
    actor: REVIEWER,
    note: "blocking checks not satisfied",
  };
}

async function tick() {
  const item = await api("POST", "/queue/lease", { holder: REVIEWER });
  if (!item) return false; // nothing pending
  console.log(`leased ${item.id} (${item.gateId})`);

  const decision = { ...review(item), leaseToken: item.lease.token };
  try {
    const { state } = await api("POST", `/queue/${item.id}/decision`, decision);
    console.log(`  -> ${state.status}`);
  } catch (err) {
    if (err.status === 422) {
      // Engine refused (e.g. a positive outcome with failing checks). Hand back.
      await api("POST", `/queue/${item.id}/release`, { leaseToken: item.lease.token });
      console.log(`  -> refused (${err.message}); released`);
    } else {
      throw err;
    }
  }
  return true;
}

console.log(`reviewer ${REVIEWER} polling ${BASE} every ${POLL_MS}ms (Ctrl-C to stop)`);
for (;;) {
  try {
    const worked = await tick();
    if (!worked) await new Promise((r) => setTimeout(r, POLL_MS));
  } catch (err) {
    console.error("error:", err.message);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
