# Open Gates

**Event sourcing for the one decision where a claim becomes money.**
Not task management — fact acceptance.

Open Gates is an open standard and a dependency-free reference engine for the
**Acceptance Act**: the bounded moment an organization turns a *submitted claim*
into an *accepted, payable fact* — checked against a trusted reference, decided by
a proven authority, with effects that fire **exactly once** from a log that
**replays to the same state forever**.

It owns that one decision and nothing else. It is not a workflow engine, an ERP,
or a BPM tool — it drops *into* those (and into agents, over MCP) as the typed,
auditable acceptance step.

---

## See it in 60 seconds

The engine runs TypeScript directly — Node ≥ 22.18, no build, no dependencies.

```bash
cd engine
npm run demo:dispute    # a claim that fails the claim-vs-reality check
```

A contractor claims **120 m³** of concrete. The independent survey measures
**100 m³** — `|120 − 100| = 20 m³`, **20% of the reference**, far outside the 5%
tolerance. The engine refuses acceptance:

```jsonc
{ "status": "returned_for_rework",
  "checksPassed": false,
  "checks": [
    { "id": "executive-docs-present", "outcome": "pass" },
    { "id": "claim-matches-survey",   "outcome": "fail",
      "detail": "|claim−ref|=20 (20.00% of ref 100) exceeds limit 5" },
    { "id": "billable-quantity",      "outcome": "pass" } ],
  "consequences": [
    { "effect": "dataset_label", "payload": { "dataset": "construction.work_acceptance" } } ] }
// only the audit label fired — no money, no unlock, no risk. The stage stays locked.
```

```bash
npm run demo:accept     # the same gate, an honest claim
```

Now the survey reads **117 m³ ± 4 (k=2)**. The error is 2.56% of the reference —
within tolerance *and* within measurement uncertainty — so the supervisor accepts
**117, not the claimed 120**, and money is computed on what was accepted:

```jsonc
{ "status": "accepted", "checksPassed": true, "cycleDays": 2.25,
  "consequences": [
    { "effect": "money", "payload": { "quantity": 117, "quantitySource": "accepted",
        "gross": 9945, "retention": 497.25, "net": 9447.75, "vat": 1889.55 } },
    { "effect": "right_to_proceed", "payload": { "unlocks": "WP-foundation-closeout" } },
    { "effect": "risk", "payload": { "assignedTo": "technical_supervisor" } },
    { "effect": "dataset_label", "payload": { "dataset": "construction.work_acceptance" } } ] }
```

That one run is the whole project: a claim met reality, money moved on the
**accepted** quantity less retention, a role took the risk, and a labelled record
joined a dataset — all replayable, byte-for-byte, a year later in an audit.

---

## What an Acceptance Act is

```text
claim ──▶ reference ──▶ checks ──▶ authority decides ──▶ accepted quantity ──▶ effects
        (the survey)  (tolerance      (proven by         (not the claimed       (money − retention,
                       + uncertainty)  token scope)        quantity)              unlock, risk, label)
```

Formally it is eight typed elements, `⟨ Context, Subject, Grounds, Criteria,
Authority, Decision, Effect, Record ⟩`. The spec and engine implement them with
short, code-friendly names — the bridge lives in **one** place,
[`GLOSSARY.md`](GLOSSARY.md):

| Acceptance Act | In the spec & engine |
|----------------|----------------------|
| Subject / Grounds / Criteria | `claim` / `evidence` / `checks` |
| Authority / Decision / Effect | `reviewer` / `decision` / `consequences` |
| Record | the append-only **event log** that **folds** into state |

## Record = event sourcing

A case is an append-only log of events that `fold` reduces to state. The fold is
**pure and deterministic** — it reads no wall clock and no randomness, dedups
redelivered events by id, and rejects out-of-order ones — so the same log always
yields the same state and every state is explainable from its history. Effects
carry a stable `effectId`, so paying or webhooking them is exactly-once on replay.
That contract is enforced by [property tests](engine/test/fold.test.ts); see
[`engine/src/fold.ts`](engine/src/fold.ts) and [`SPEC.md` §2–3](SPEC.md).

## Claim vs. reality, done right

The defining check, `cross_check`, measures the error **against the reference**
(the surveyed value, per VIM §2.16) — not the claim — with an absolute floor and,
when the evidence carries an expanded uncertainty `U` (GUM, `U = k·u`), a
hard uncertainty band. Honest measurement, not a hand-wave. See
[`STANDARDS.md`](STANDARDS.md) and [`SPEC.md` §4](SPEC.md).

## Money is real

Payment is computed on the **accepted** quantity, in integer minor units, less
guarantee retention, with a VAT memo and payment terms — and the folded state
carries `cycleDays` (free, from event timestamps) so the audit log doubles as a
cost-of-delay / leakage dataset. The auto-accept ceiling is the review-vs-leakage
break-even, not a magic number. See [`docs/ECONOMICS.md`](docs/ECONOMICS.md).

## Integration: durable execution and agents

- **Durable execution** — Open Gates is event sourcing for *one decision*, not a
  runtime. Embed `fold(gate, events)` as the deterministic decision step inside
  Temporal / Inngest / Restate; wrap I/O in the orchestrator's step, never the
  fold. [`docs/DURABLE-EXECUTION.md`](docs/DURABLE-EXECUTION.md).
- **Agents** — an [MCP](docs/MCP.md) server exposes the lifecycle as typed tools
  and `og://` resources, protected by OAuth 2.1. **Authority is proven by token
  scope, never self-asserted**: an agent can't decide a gate it lacks
  `og:decide:<role>` for, and a [hook](.claude/hooks/) hard-denies a forced
  acceptance before the call leaves. [`docs/MCP.md`](docs/MCP.md).

---

## What's in this repository

| Level | What | Where |
|------:|------|-------|
| **0** | The Acceptance Act — the primitive | this README |
| **1** | Spec — events & fold, the metrology-aware checks, accepted-quantity money | [`SPEC.md`](SPEC.md), [`spec/schema/`](spec/schema/) |
| **2** | Examples — construction (work volume, hidden works) and logistics, worked | [`examples/`](examples/) |
| **3** | Reference engine — the dependency-free, event-sourced fold | [`engine/`](engine/) |
| **4** | Standards — real, field-level mappings (PROV-O, DMN, GUM/VIM, EVM) | [`STANDARDS.md`](STANDARDS.md) |
| **5** | Service & agents — review queue, durable execution, MCP + OAuth, hooks | [`docs/`](docs/) |

Open questions and unbuilt verticals live in [`ROADMAP.md`](ROADMAP.md), not here.

## Quickstart

```bash
cd engine
npm run demo:dispute    # claim 120 vs survey 100 -> returned, €0, stage locked
npm run demo:accept     # survey 117±4 -> accept 117, €9,447.75 net certified
npm run demo:remarks    # accepted_with_exceptions, retention held against a punch list
npm test                # 61 tests incl. determinism + idempotency + fencing + SLA + OAuth + MCP
```

From the repo root, `npm run eval` scores the automation policy against a labelled
dataset (coverage 0.5, agreement 1.0, false-accept 0).

## Deploy

The engine is a pure function, so it ships without any model-serving stack:

- **Vercel (default)** — the stateless engine (`/fold`, `/autodecide`). Push and
  import, or `npx vercel`.
- **Docker (self-host)** — the engine **plus** the review queue (push & pull,
  SLAs, fencing leases, delegation trail), and the MCP server:

  ```bash
  docker compose up --build      # or: npm run serve   (Node ≥ 22.18, no build)
  ```

See [`docs/REVIEW-QUEUE.md`](docs/REVIEW-QUEUE.md).

## What it is / is not

**Is:** an open standard plus a small reference engine for the acceptance
boundary — the typed, event-sourced, replayable step where a claim becomes a
payable fact, with proven authority and exactly-once effects.

**Is not:** a workflow runtime, an ERP, a BPM tool, or an AI automation
framework. It owns the one decision and integrates with the rest.

## License

MIT — see [`LICENSE`](LICENSE).
