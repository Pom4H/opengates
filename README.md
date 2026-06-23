# Open Gates

**An open standard for the Acceptance Act** — the bounded moment a *submitted
claim* becomes an *accepted, payable fact*: checked against a trusted reference,
decided by a proven authority, recorded as a replayable event log.
Not task management — fact acceptance.

> Like OpenAPI, this repository is a **specification plus a conformance suite**,
> not a runtime. The normative artifacts are [`SPEC.md`](SPEC.md), the
> [JSON Schemas](spec/schema/), and the [conformance goldens](conformance/). A
> reference implementation lives in [`packages/engine/`](packages/engine/) — it is
> **non-normative**; implement the standard in any language and prove it against
> the same golden files.

---

## What an Acceptance Act is

```text
claim ──▶ reference ──▶ checks ──▶ authority decides ──▶ accepted quantity ──▶ effects
        (the survey)  (tolerance      (proven role)      (not the claimed       (money − retention,
                       + uncertainty)                     quantity)              unlock, risk, label)
```

Formally, eight typed elements: `⟨ Context, Subject, Grounds, Criteria, Authority,
Decision, Effect, Record ⟩`. The spec uses short, code-friendly names for each;
the bridge is defined once, in [`GLOSSARY.md`](GLOSSARY.md):

| Acceptance Act | In the spec |
|----------------|-------------|
| Context | the gate definition |
| Subject / Grounds / Criteria | `claim` / `evidence` / `checks` |
| Authority / Decision / Effect | `reviewer` / `decision` / `consequences` |
| Record | the append-only **event log** that **folds** into state |

## The spec is executable — see it in a folded case

A gate case is an event log; folding it yields a state. A **disputed** claim
(survey 100 vs. claim 120 — 20% of the reference, outside the 5% tolerance) cannot
be accepted:

```jsonc
{ "status": "returned_for_rework", "checksPassed": false,
  "checks": [ { "id": "claim-matches-survey", "outcome": "fail",
               "detail": "|claim−ref|=20 (20.00% of ref 100) exceeds limit 5" } ],
  "consequences": [ { "effect": "dataset_label", "payload": { "dataset": "construction.work_acceptance" } } ] }
// only the audit label fired — no money, no unlock. The stage stays locked.
```

An **honest** claim (survey 117 ± 4, k=2 — within tolerance *and* measurement
uncertainty) is accepted on the **surveyed 117, not the claimed 120**, and money is
computed on what was accepted:

```jsonc
{ "status": "accepted", "checksPassed": true, "cycleDays": 2.25,
  "consequences": [
    { "effect": "money", "payload": { "quantity": 117, "quantitySource": "accepted",
        "gross": 9945, "retention": 497.25, "net": 9447.75, "vat": 1889.55 } },
    { "effect": "right_to_proceed", "payload": { "unlocks": "WP-foundation-closeout" } },
    { "effect": "risk", "payload": { "assignedTo": "technical_supervisor" } } ] }
```

These two states are conformance cases — every engine must reproduce them (below).
Run them with the reference impl: `cd packages/engine && npm run demo:dispute` /
`demo:accept`.

## The record is an event log (event sourcing)

A case is an append-only log; `fold(gate, events) → state` is a **pure,
deterministic** reduction — it reads no wall clock and no randomness, dedups
redelivered events by `id`, and rejects out-of-order ones. The same log yields the
same state forever, and every state is explainable from its history. Normative in
[`SPEC.md` §2–3](SPEC.md).

## Claim vs. reality, done right

The defining check, `cross_check`, measures error **against the reference** (the
surveyed value, per VIM §2.16) — not the claim — with an absolute floor and, when
the evidence carries an expanded uncertainty `U` (GUM, `U = k·u`), a hard
uncertainty band. Honest measurement, not a hand-wave. [`SPEC.md` §4.1](SPEC.md),
[`STANDARDS.md`](STANDARDS.md).

## Money is real

Payment is computed on the **accepted** quantity, in integer minor units, less
retention, with a VAT memo — and the folded state carries `cycleDays` (free, from
event timestamps). The auto-accept ceiling is a review-vs-leakage break-even, not a
magic number. [`SPEC.md` §6.1](SPEC.md), [`docs/ECONOMICS.md`](docs/ECONOMICS.md).

## Conformance — the contract is data, not code

This is what makes Open Gates a standard. [`conformance/`](conformance/) holds, for
each case, the **normative state any engine must fold to** — in any language. Five
cases across two domains; the reference engine passes all five:

```bash
npm run conformance     # ✓ construction.accept / dispute / remarks · logistics.accept / dispute
```

The golden files are the authority; the reference engine is one passing
implementation, not privileged. To certify your own engine, fold each case and
compare to [`conformance/expected/`](conformance/expected/) — see
[`conformance/README.md`](conformance/README.md) for the normative projection.

## Standards it speaks

The record maps onto formats existing software and AI already read — W3C PROV-O,
OMG DMN, GUM/VIM, ISO/IEC 17025, ANSI/EIA-748 (EVM) — with an honest
load-bearing-vs-decorative split. [`STANDARDS.md`](STANDARDS.md).

---

## What's in this repository

**Normative — the standard:**

| | What | Where |
|---|------|-------|
| **Spec** | the Acceptance Act, events & fold, the metrology-aware checks, accepted-quantity money | [`SPEC.md`](SPEC.md) |
| **Schemas** | machine-readable gate / event / scenario / dataset-label | [`spec/schema/`](spec/schema/) |
| **Conformance** | golden states every engine must reproduce | [`conformance/`](conformance/) |
| **Examples** | worked gates — construction (work volume, hidden works), logistics | [`examples/`](examples/) |
| **Standards** | real, field-level mappings | [`STANDARDS.md`](STANDARDS.md) |

**Non-normative — one implementation & its tooling:**

| | What | Where |
|---|------|-------|
| **Reference engine** | a dependency-free TypeScript fold | [`packages/engine/`](packages/engine/) |
| **Runtime & integration** | review queue, OAuth 2.1, MCP server, durable-execution embedding | [`docs/`](docs/) |
| **Roadmap** | unbuilt verticals and products (incl. a hosted service) | [`ROADMAP.md`](ROADMAP.md) |

---

## Reference implementation (non-normative)

[`packages/engine/`](packages/engine/) makes the spec executable and generates the
conformance goldens. It runs TypeScript directly — Node ≥ 22.18, no build, no
dependencies — so you can read it as living pseudocode or run it as-is.

```bash
cd packages/engine
npm test                # 61 tests incl. determinism + idempotency + fencing + SLA + OAuth + MCP
npm run demo:accept     # fold the accepted case -> €9,447.75 net certified
```

It also ships a **runtime layer that is not part of the standard** — a push/pull
review queue (fencing leases, SLAs, delegation trail), OAuth 2.1 authority where
the reviewer role is proven by token scope, an MCP server so an agent can drive the
loop, and guidance for embedding the fold as a step in Temporal / Inngest /
Restate. These are conveniences built **on** the Acceptance Act, not part of it:

- Deploy & review queue → [`docs/REVIEW-QUEUE.md`](docs/REVIEW-QUEUE.md)
- Agents (MCP + OAuth) → [`docs/MCP.md`](docs/MCP.md)
- Durable execution → [`docs/DURABLE-EXECUTION.md`](docs/DURABLE-EXECUTION.md)

```bash
# stateless spec engine on Vercel, or the full queue + MCP self-hosted:
docker compose up --build      # or: npm run serve   (Node ≥ 22.18, no build)
```

## What it is / is not

**Is:** an open standard for the acceptance boundary — the typed, event-sourced,
replayable step where a claim becomes a payable fact — with a conformance suite and
one reference implementation.

**Is not:** a workflow runtime, an ERP, a BPM tool, or an AI framework. The
standard owns the one decision; runtimes and products are built on it, not baked in.

## License

MIT — see [`LICENSE`](LICENSE).
