# @open-gates/engine — reference implementation (non-normative)

> **Non-normative.** This is *one* implementation of the
> [Open Gates spec](../../SPEC.md), provided to make the standard executable and
> to generate the [conformance golden files](../../conformance/). The normative
> artifacts are [`SPEC.md`](../../SPEC.md), the [JSON Schemas](../../spec/schema/),
> and [`conformance/`](../../conformance/). **Any** engine, in any language, that
> reproduces the conformance states is conformant — this one is not privileged.

It does one thing that *is* normative — **fold** a gate's event log into a state:

```text
claim → evidence → checks → decision → consequences → dataset label
```

Dependency-free TypeScript; runs directly on Node ≥ 22.18 via built-in type
stripping — no build step, no `node_modules`.

## Run it (from the repo root)

```bash
npm test            # the suite (node:test)
npm run demo:accept # fold the accepted construction scenario
npm run conformance # check the reference fold against the golden files
```

Or point the CLI at any gate + scenario:

```bash
node packages/engine/src/cli.ts <gate.json> <scenario.json>
```

## Use it as a library

```ts
import { fold, autodecide, loadGate, loadScenario } from "@open-gates/engine";

const gate = loadGate(/* gate definition object */);
const state = fold(gate, loadScenario(scenario).events);

state.status;          // "accepted" | "returned_for_rework" | ...
state.consequences;    // money / right_to_proceed / risk / dataset_label
state.responsibility;  // who accepted the fact (a proven role)

// `now` is REQUIRED — fold reads no wall clock, so replay is deterministic.
const auto = autodecide(gate, state, now);
```

## Layout

| Path | Responsibility |
|------|----------------|
| `src/{types,checks,consequences,effects,fold,index}.ts` | the **normative** fold — mirrors [`spec/schema/`](../../spec/schema/) |
| `src/dataset.ts` | features → label records (the eval substrate) |
| `src/auth.ts`, `src/token.ts` | OAuth 2.1 resource guard + token minter (**runtime**, not in the spec) |
| `src/queue/*` | the push/pull review queue with fencing leases + SLA (**runtime**) |
| `src/mcp/*` | a dependency-free MCP server, a thin client of the queue (**runtime**) |
| `test/*` | tests, incl. the determinism / idempotency property tests |

## Design notes

- **Pure & deterministic.** `fold` is a reduce over events that reads no
  `Date.now()`, `Math.random()`, or environment; the same log always yields the
  same state. Events are never mutated.
- **Erasable TypeScript only.** No `enum`, `namespace`, parameter properties, or
  decorators, so it runs under type stripping (`tsconfig.json` sets
  `erasableSyntaxOnly`).
- **Role-bound responsibility.** Only the gate's `reviewer.role` may decide; a
  positive decision requires all blocking checks to pass.

The queue, auth, and MCP server are **runtime conveniences** built on the fold,
not part of the standard. See [`ROADMAP.md`](../../ROADMAP.md) and
[`docs/`](../../docs/).
