# <Domain> — <gate name>

> Template. Copy this directory to `examples/<your-domain>/` and fill it in.
> Prose-only is fine; add `gate.json` and `scenario.*.json` if you can.

**The expensive disputed fact:** _one sentence — what is asserted but not yet
accepted, and why it costs money while it sits unaccepted._

## The seven questions

**Claim** — what fact does someone assert?
> e.g. "contractor asserts X units of work completed in period P"

**Evidence** — what proves it?
> e.g. independent measurement, signed document, photo, sensor reading

**Checks** — how is it verified? (especially: claim vs. reality)
> e.g. required evidence present; claimed quantity within N% of measured

**Reviewer** — which role accepts responsibility?
> e.g. site supervisor / QC inspector / adjuster

**Decision** — what outcomes are possible?
> e.g. accepted / accepted_with_exceptions / rejected / returned_for_rework

**Consequence** — what appears on acceptance?
> money: ___   right to proceed: ___   risk assigned to: ___

**Dataset** — what labelled record accumulates?
> e.g. `<domain>.<gate>` — features (claim + evidence + checks) → decision

## Machine-readable (optional)

Add `gate.json` matching
[`../../spec/schema/gate.schema.json`](../../spec/schema/gate.schema.json) and
run it:

```bash
cd ../../engine
node src/cli.ts ../examples/<your-domain>/gate.json ../examples/<your-domain>/scenario.accept.json
```
