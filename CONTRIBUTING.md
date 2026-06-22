# Contributing to Open Gates

There are two ways to contribute, and **you do not need to write code for the
first one.**

## 1. Bring domain knowledge (the most valuable contribution)

Open Gates wants to become a living encyclopedia of operational patterns. If you
know an industry, you know where its expensive disputed facts are. Capture one
gate.

You do not have to model everything. Describe one acceptance point by answering
seven questions:

```text
claim       — what fact does someone assert?
evidence    — what proves it?
checks      — how is it verified? (especially: claim vs. reality)
reviewer    — which role accepts responsibility?
decision    — what outcomes are possible?
consequence — what money / risk / right-to-proceed appears on acceptance?
dataset     — what labelled record accumulates?
```

To add one:

1. Copy [`examples/_template/`](examples/_template/) to
   `examples/<your-domain>/`.
2. Fill in `README.md` (prose — the seven questions above) and, if you can,
   `gate.json` (the machine-readable definition).
3. Optionally add `scenario.*.json` runs (a happy path and a disputed path).
4. Add a row to the table in [`examples/README.md`](examples/README.md).

Prose-only contributions are welcome. Someone else can turn them into a
`gate.json` later.

## 2. Improve the spec or the engine

- The normative spec is [`SPEC.md`](SPEC.md); machine-readable schemas are in
  [`spec/schema/`](spec/schema/).
- The reference engine is in [`engine/`](engine/). It is dependency-free and
  runs on Node ≥ 22.18 (TypeScript via type stripping — no build step).

```bash
cd engine
npm test          # run the suite
npm run demo:accept
```

Keep the engine **erasable TypeScript** (no `enum`, `namespace`, parameter
properties, or decorators) so it keeps running under Node's type stripping. When
you add a check rule, consequence effect, or event type, update in lockstep:

```text
engine/src/types.ts   →  the schema in spec/schema/   →  SPEC.md   →  a test
```

## Conventions

- Gate ids are `<domain>.<gate-name>`, lowercase, hyphenated.
- Money examples use illustrative numbers; mark them as such.
- Prefer real, named pains over abstract ones — "contractor claims a volume,
  supervision hasn't accepted it" beats "process step needs approval."

## License

By contributing you agree your contribution is licensed under the repository's
[MIT license](LICENSE).
