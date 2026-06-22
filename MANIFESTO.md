# The Business Gate Pattern — a Manifesto

> Level 0 of the [Open Gates ladder](README.md#whats-in-this-repository).

## The primitive

Most software starts from the wrong end. It starts with an *app*: a CRM, a
dashboard, a workflow, an ERP module. Open Gates starts from a smaller,
load-bearing primitive that exists in every operation, named or not:

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

We call the place where this happens a **gate**: a named decision point where a
**claim becomes an accepted fact** — or is rejected — and where that acceptance
has real consequences.

## Why this is the right altitude

Pick almost any industry and you will find the same expensive pain:

> **A fact has been asserted, but not yet accepted.**

While it sits in that limbo:

- money is frozen (nobody can pay for an unaccepted fact);
- the next step is blocked (you can't proceed on something unconfirmed);
- responsibility is murky (who said this was true?);
- disputes accumulate (claim vs. reality);
- data stays dirty (no clean label of what was actually accepted);
- AI doesn't know what to trust (there is no ground truth).

Open Gates says: **make that moment explicit.** Give the claim a shape, attach
the evidence, run the checks, name the role that accepts responsibility, record
the decision, and let the consequences — money, risk, the right to proceed —
fall out deterministically. Then keep the labelled record.

## Not another category

Open Gates is deliberately **not**:

```text
an open-source ERP
an open-source workflow engine
a construction management system
an AI automation framework
a BPM alternative
```

Those framings drop us into old categories with old expectations. The honest
framing is smaller and more fundamental:

```text
acceptance infrastructure
an operational truth layer
the business gate pattern
a claim-to-consequence protocol
```

It is the layer where real business becomes a **verifiable, executable,
automatable model**.

## A methodology, not just a format

For a developer, Open Gates is a way of working. It says:

> Don't start with the application. **Find the gate.** Where does a claim become
> an accepted fact? Where, after an approval, do money, status, or access to the
> next step change?

That is the move that turns "coding for code's sake" into building digital
contours around the decisions a business actually cares about. We call this role
the **Applied Systems Builder**.

For a business, it replaces "we need a CRM / AI / a dashboard" with a sharper
question:

> **Where is your most expensive disputed fact?**

Answer that, model that one gate, and you have started digitizing — without a
giant rollout.

## The ladder

Open Gates grows in levels. Each is useful on its own; each makes the next
possible.

```text
Level 0 — Manifesto            the Business Gate Pattern (this document)
Level 1 — Spec                 Claim / Evidence / Check / Decision / Consequence
Level 2 — Examples             construction, logistics, manufacturing, retail, …
Level 3 — Reference engine     a small TypeScript / Python fold engine
Level 4 — Standards mappings   W3C PROV, BPMN/DMN, IFC, EVM, ISO 19650
Level 5 — Agent workspace      Claude skills, subagents, review workflows
Level 6 — Vertical MVP         Construction PR (contractor → claim → supervision → payable EV)
Level 7 — Commercial product   an operational truth layer for accepted work
```

## The shortest formulas

> Open Gates is the entry point for people and AI into real business through its
> most important moment — **the acceptance of a fact.**

And shorter still:

> **Not task management. Fact acceptance.**

That is the core.
