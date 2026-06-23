# Examples — gates by industry

> The case catalog of [Open Gates](../README.md): the most expensive disputed
> fact in each industry, modelled as a gate.

Each gate is a place where a claim becomes an accepted fact with consequences.
Two are fully worked — a machine-readable `gate.json` plus runnable scenarios and
tests; the rest live as one-line entries in [`CATALOG.md`](CATALOG.md) until
someone turns them into a gate.

## Worked

| Domain | Gate | The disputed fact | Settled by |
|--------|------|-------------------|-----------|
| [construction](construction/) | work-volume acceptance | contractor claims 120 m³; supervision surveys 117 | reference survey + tolerance + measurement uncertainty |
| [logistics](logistics/) | delivery acceptance | carrier claims on-time delivery; it arrived a day late | POD + a delivery-window check |

Construction also carries a second gate — [hidden-works (AOSR)](construction/hidden-works/) —
whose value is a *temporal* lock: the act must be signed before the work is covered.

And [`construction/systems/`](construction/systems/) accepts four parallel systems
(structure → envelope → MEP → fit-out) on one **zone** — the worked example behind
the 3D operational map (`npm run demo:zone`; [`viz/`](../viz/README.md)).

## The shape of a gate

Every example answers the same questions:

```text
claim       what fact is asserted?
evidence    what backs it? (the trusted reference)
checks      how is it verified? (claim vs. reference, with tolerance + uncertainty)
reviewer    which role accepts responsibility?
decision    what outcomes are possible?
consequence what money / risk / right-to-proceed appears?
dataset     what labelled record accumulates?
```

Start with [construction](construction/) — it is fully worked, with a gate
definition, accept / dispute / remarks scenarios, a hidden-works gate, a labelled
dataset, and tests. To add a gate, copy [`_template/`](_template/) and see
[`../CONTRIBUTING.md`](../CONTRIBUTING.md); unworked ideas go in
[`CATALOG.md`](CATALOG.md).
