# @open-gates/engine — reference fold engine

> Level 3 of the [ladder](../README.md#whats-in-this-repository). A small,
> dependency-free TypeScript implementation of the [spec](../SPEC.md).

It does one thing: **fold** a gate's event log into a state.

```text
claim → evidence → checks → decision → consequences → dataset label
```

## Run it

Requires **Node ≥ 22.18** — TypeScript runs directly via Node's built-in type
stripping, so there is no build step and no `node_modules`.

```bash
npm test            # run the test suite (node:test)
npm run demo:accept # fold the accepted construction scenario
npm run demo:dispute# fold the disputed construction scenario
```

Or point the CLI at any gate + scenario:

```bash
node src/cli.ts <gate.json> <scenario.json>
```

## Use it as a library

```ts
import { fold, autodecide, loadGate } from "@open-gates/engine"; // ./src/index.ts

const gate = loadGate(/* gate definition object */);
const state = fold(gate, events); // events: GateEvent[]

state.status;          // "accepted" | "rejected" | "returned_for_rework" | ...
state.checksPassed;    // boolean
state.consequences;    // money / right_to_proceed / risk / dataset_label
state.responsibility;  // who accepted the fact
state.datasetLabel;    // labelled record for future automation

// The automation path: what a policy would decide, or null if a human is needed.
const auto = autodecide(gate, state);
```

## Layout

| File | Responsibility |
|------|----------------|
| `src/types.ts` | Core types (mirror of [`spec/schema/`](../spec/schema/)). |
| `src/checks.ts` | Deterministic check evaluation. |
| `src/consequences.ts` | Money / right-to-proceed / risk / dataset-label effects. |
| `src/fold.ts` | The reducer: `apply` one event, `fold` the whole log. |
| `src/index.ts` | Public API + `loadGate`, `loadScenario`, `autodecide`. |
| `src/cli.ts` | `node src/cli.ts <gate> <scenario>`. |
| `test/fold.test.ts` | End-to-end tests over the construction example. |

## Design notes

- **Pure & deterministic.** `fold` is a reduce over events; the same log always
  yields the same state. Events are never mutated.
- **Erasable TypeScript only.** No `enum`, `namespace`, parameter properties, or
  decorators — so it runs under type stripping. `tsconfig.json` sets
  `erasableSyntaxOnly` to keep it that way.
- **Role-bound responsibility.** Only the gate's `reviewer.role` can decide; a
  positive decision requires all blocking checks to pass.
