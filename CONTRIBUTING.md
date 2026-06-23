# Contributing to Open Gates

There are two ways to contribute, and **you do not need to write code for the
first one.**

## 1. Bring domain knowledge (the most valuable contribution)

Open Gates wants to become a living encyclopedia of acceptance points. If you
know an industry, you know where its expensive disputed facts are. Capture one
gate.

You do not have to model everything. Describe one acceptance point by answering
seven questions:

```text
claim       — what fact does someone assert?
evidence    — what proves it?
checks      — how is it verified? (especially: claim vs. a trusted reference)
reviewer    — which role accepts responsibility?
decision    — what outcomes are possible?
consequence — what money / risk / right-to-proceed appears on acceptance?
dataset     — what labelled record accumulates?
```

To add a gate:

1. Copy [`examples/_template/`](examples/_template/) to
   `examples/<your-domain>/`.
2. Fill in `gate.json` (the machine-readable definition) and `README.md` (prose
   — the seven questions above).
3. Add `scenario.*.json` runs — at minimum a happy path and a disputed path.
   The construction gate ships
   [`scenario.accept.json`](examples/construction/scenario.accept.json),
   [`scenario.dispute.json`](examples/construction/scenario.dispute.json), and
   [`scenario.remarks.json`](examples/construction/scenario.remarks.json) as a
   reference shape.
4. Add a row to [`examples/README.md`](examples/README.md) or
   [`examples/CATALOG.md`](examples/CATALOG.md).

Prose-only contributions are welcome. Someone else can turn them into a
`gate.json` later.

## 2. Improve the spec or the engine

- The normative spec is [`SPEC.md`](SPEC.md); machine-readable schemas are in
  [`spec/schema/`](spec/schema/).
- The reference engine is in [`packages/engine/`](packages/engine/). It is dependency-free and
  runs on Node ≥ 22.18 (TypeScript via type stripping — no build step).

```bash
cd packages/engine
npm test          # run the suite
npm run demo:accept
```

### Erasable TypeScript

Keep the engine **erasable TypeScript**: no `enum`, no `namespace`, no
decorators, no parameter properties. It must keep running under Node's built-in
type stripping with no build step. The whole repo is **dependency-free** (Node
built-ins only) — including the [`packages/engine/src/mcp/`](packages/engine/src/mcp/) server, which
speaks its own JSON-RPC over stdio instead of pulling in an SDK. Keep it that way.

### Change these four in lockstep

When you add or change a check rule, consequence effect, event type, event
identity, or how accepted-quantity money is computed, update all four:

```text
packages/engine/src/types.ts   →   spec/schema/   →   SPEC.md   →   a test
```

Two invariants make the lockstep load-bearing:

- **Event identity.** Every persisted event carries `id` + `seq`.
  `normalizeLog(caseId, events)` assigns `seq = i + 1` and
  `id = ${caseId}#${seq}`. `fold` dedups by `id` and requires
  `seq === state.seq + 1`. If you touch event shape, the schema, the spec, and
  [`packages/engine/test/fold.test.ts`](packages/engine/test/fold.test.ts) must agree.
- **Accepted-quantity money.** Money is paid on the **accepted** quantity, not
  the claimed one: `decision.acceptedValues` → the surveyed reference → the
  claim, in that order of precedence. The breakdown is computed in integer minor
  units (cents): `gross`, `retention = min(gross × retentionPct, retentionCap)`,
  `net = gross − retention`, `vat = net × vatRate`. A change here needs a test
  pinning the numbers.

Keep `fold` pure — it reads no `Date.now()`, `Math.random()`, or environment.
`autodecide(gate, state, now)` takes `now` explicitly; there is no wall-clock
default. Property tests in [`packages/engine/test/fold.test.ts`](packages/engine/test/fold.test.ts)
cover dedup, ordering, and idempotence.

## Conventions

- **Gate ids** are `<domain>.<gate-name>`, lowercase, hyphenated.
- **Illustrative money is marked as such.** Rates and the cent-level breakdowns
  in examples are worked numbers for a sample case, not a price list.
- **`cross_check` error is normalized by the reference**, not the claim: a claim
  of 120 against a survey of 117 is `|120 − 117| / 117 = 2.56%`, compared to the
  gate's `tolerance`. State the denominator wherever you quote a percentage.
- **Cyrillic (and other non-English) domain terms** are paired with an English
  gloss in prose and kept out of JSON keys. Estimate line `ФЕР06-01-001-01` may
  appear as an evidence *value*; schema keys stay ASCII.
- Prefer real, named pains over abstract ones — "contractor claims a volume,
  supervision hasn't accepted it" beats "process step needs approval."

## License

By contributing you agree your contribution is licensed under the repository's
[MIT license](LICENSE).
