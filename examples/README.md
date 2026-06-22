# Examples — a catalog of business gates

> Level 2 of the [ladder](../README.md#whats-in-this-repository).

Each directory describes one **gate**: a place where a claim becomes an accepted
fact with consequences. The goal is a living encyclopedia of operational
patterns across industries.

You don't need to write code to contribute one — prose is enough. See
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) and the
[`_template/`](_template/).

## Catalog

| Domain | Gate | The expensive disputed fact | Status |
|--------|------|------------------------------|--------|
| [construction](construction/) | work-volume acceptance | contractor claims a volume; supervision hasn't accepted it | ✅ worked (gate + scenarios + tests) |
| [logistics](logistics/) | delivery acceptance | driver claims delivery; customer disputes it | 📝 prose stub |
| [manufacturing](manufacturing/) | batch QC acceptance | a batch is claimed good; QC finds a defect | 📝 prose stub |
| [retail](retail/) | goods receiving | supplier claims a shipment; the warehouse received less | 📝 prose stub |
| [agriculture](agriculture/) | field-treatment acceptance | a field was treated; the agronomist isn't sure | 📝 prose stub |
| [healthcare](healthcare/) | service confirmation | a service was rendered; the insurer won't confirm it | 📝 prose stub |
| [insurance](insurance/) | claim adjudication | a loss is claimed; the adjuster must confirm it | 📝 prose stub |

`✅ worked` = has a machine-readable `gate.json` and runnable scenarios.
`📝 prose stub` = the seven questions answered in prose; ready to be turned into
a `gate.json`.

## The shape of a gate

Every example answers the same seven questions:

```text
claim       → what fact is asserted?
evidence    → what proves it?
checks      → how is it verified? (especially claim vs. reality)
reviewer    → which role accepts responsibility?
decision    → what outcomes are possible?
consequence → what money / risk / right-to-proceed appears?
dataset     → what labelled record accumulates?
```

Start with [construction](construction/) — it is fully worked, with a gate
definition, an accepted scenario, a disputed scenario, and tests.
