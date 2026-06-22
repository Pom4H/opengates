# Open Gates

**Not task management. Fact acceptance.**

Open Gates is a starting point for turning messy real-world operations into
**verifiable, auditable, automatable business gates** — the moments where a
*claim* becomes an *accepted fact* with consequences.

It is not an ERP, a workflow engine, a BPM tool, or "AI for business." It is a
smaller, more fundamental primitive that sits underneath all of those:

```text
someone asserted a fact        (claim)
  → proved it                  (evidence)
  → the system verified it     (checks)
  → a role accepted it         (decision / responsibility)
  → status changed             (state)
  → money / risk / the right to proceed appeared   (consequence)
  → a dataset accumulated      (labels)
  → some decisions became automatable               (automation)
```

In almost every industry there is the same expensive pain:

> **A fact has been asserted, but not yet accepted.**

And until it is accepted, money is frozen, the next step is blocked,
responsibility is murky, disputes pile up, data stays dirty, and AI doesn't
know what to trust. Open Gates makes that moment **explicit, executable, and
recordable**.

> Open Gates — точка входа для превращения хаотичной операционки в проверяемые
> бизнес-гейты, где заявления становятся признанными фактами с последствиями.

---

## The one question

Business usually asks "we need a CRM / a dashboard / AI / automation."
Open Gates asks a different question:

> **Where is your most expensive disputed fact?**

```text
construction:   contractor claims a volume — site supervision hasn't accepted it
logistics:      driver claims delivery — customer disputes it
manufacturing:  a batch is claimed good — QC finds a defect
retail:         supplier claims a shipment — the warehouse received less
healthcare:     a service was rendered — the insurer won't confirm it
agriculture:    a field was treated — the agronomist isn't sure
```

Find that gate. Model it. That is your entry point into digitization — without
a giant ERP rollout.

---

## What's in this repository

This repo is organized as a ladder, from idea to running code:

| Level | What | Where |
|------:|------|-------|
| **0** | Manifesto — the Business Gate Pattern | [`MANIFESTO.md`](MANIFESTO.md) |
| **1** | Spec — Claim / Evidence / Check / Decision / Consequence schemas | [`SPEC.md`](SPEC.md), [`spec/schema/`](spec/schema/) |
| **2** | Examples — a catalog of business gates by industry | [`examples/`](examples/) |
| **3** | Reference engine — a small TypeScript "fold" engine | [`engine/`](engine/) |
| 4 | Standards mappings (W3C PROV, BPMN/DMN, EVM, ISO 19650, IFC) | *planned* |
| 5 | Agent workspace (Claude skills, subagents, review workflows) | *planned* |
| 6 | Vertical MVP — Construction PR | *planned* |
| 7 | Commercial product — an operational truth layer | *planned* |

See [`GLOSSARY.md`](GLOSSARY.md) for precise definitions of every term.

---

## Quickstart

The fully worked example is **construction work-volume acceptance**: a
contractor claims a completed volume, an independent survey is attached, the
engine cross-checks the claim against the survey, and site supervision accepts
responsibility — which turns the work into payable earned value.

Requires Node ≥ 22.18 (runs TypeScript directly via type stripping — no build,
no dependencies).

```bash
cd engine

# Fold the "accepted" scenario into its final state
npm run demo:accept

# Fold the "disputed" scenario (claim outside tolerance is returned)
npm run demo:dispute

# Run the test suite
npm test
```

The accept run ends in:

```jsonc
{
  "status": "accepted",
  "checksPassed": true,
  "responsibility": { "role": "technical_supervisor", ... },
  "consequences": [
    { "effect": "money", "amount": 10200, "currency": "EUR" },   // 120 m³ × 85
    { "effect": "right_to_proceed", "unlocks": "WP-foundation-closeout" },
    { "effect": "risk", "assignedTo": "technical_supervisor" },
    { "effect": "dataset_label", "dataset": "construction.work_acceptance", ... }
  ]
}
```

That JSON *is* the point: a claim became an accepted fact, money and the right
to proceed appeared, a role owns the risk, and a labelled record was added to a
dataset that future automation can learn from.

---

## Who this is for

- **Developers** who want to leave "coding for code's sake" and become
  *Applied Systems Builders* — go into a real business and build digital
  contours around its most important decisions. Don't start with an app. Find
  the gate.
- **Businesses** that don't know where to start digitizing. Start at your most
  expensive disputed fact.
- **The open-source community** — bring *domain knowledge*, not necessarily
  code. Describe your industry's claim, evidence, checks, reviewer, decision
  and economic consequence, and the repo becomes a living encyclopedia of
  operational patterns. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **AI agents** — instead of "talking about business," an agent can take apart a
  business as an *executable system*: find the claim, the evidence, the checks,
  the reviewer, the decision, the consequence, the dataset labels.

---

## What Open Gates is *not*

It is deliberately **not** positioned as an open-source ERP, an open-source
workflow engine, a construction management system, an AI automation framework,
or a BPM alternative. Those are old categories. Open Gates is:

```text
acceptance infrastructure
an operational truth layer
the business gate pattern
a claim-to-consequence protocol
```

> **The shortest formula:** Open Gates is the entry point for people and AI into
> real business through its most important moment — **the acceptance of a fact.**

## License

MIT — see [`LICENSE`](LICENSE).
