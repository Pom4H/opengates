# Glossary

Precise definitions of the Open Gates vocabulary.

### Gate
A named decision point in an operation where a **claim** becomes an **accepted
fact** — or is rejected — with real consequences. The central primitive of Open
Gates.

### Gate definition
The reusable pattern for one kind of acceptance: claim shape, evidence
requirements, checks, reviewer role, allowed decisions, and consequences. See
[`spec/schema/gate.schema.json`](spec/schema/gate.schema.json).

### Gate case
One actual run of a gate, expressed as an append-only log of **events** that
**fold** into a **state**.

### Claim
An asserted fact: "this happened / this is true." Has a `type` and typed
`values`. A claim is not yet trusted — it is the input to a gate.

### Accepted fact
A claim that a **reviewer** has accepted responsibility for, after checks
passed. This is the output the whole pattern exists to produce.

### Evidence
Material that backs a claim and makes it checkable — a measurement, document,
photo, signature, sensor reading. Has a `kind`, optional `values`, and a `ref`
to the artifact.

### Check
A deterministic verification rule evaluated against the claim and evidence.
`blocking` checks must pass before a claim can be accepted; `warning` checks
inform but do not block. The **cross-check** (claim vs. evidence within a
tolerance) is the defining rule.

### Reviewer
The **role** authorized to accept responsibility for a decision. Only this role
may decide a gate. Acceptance transfers liability to the reviewer.

### Decision
A recorded outcome by the reviewer: `accepted`, `accepted_with_exceptions`,
`rejected`, or `returned_for_rework`.

### Responsibility
The state, set on a positive decision, recording **who** accepted the fact and
when. "Who said this was true?" stops being murky.

### Consequence
What a decision releases: **money** (payable amount), the **right to proceed**
(the next step unlocks), **risk** (liability assigned), and a **dataset label**.
This is what makes a gate matter economically.

### State
The folded result of a gate case: status, check results, decision,
responsibility, consequences, dataset label, and a human-readable log.

### Fold
The pure reduction of an event log into a state. The reference engine's core
operation: `fold(gate, events) → state`.

### Dataset label
The `features → label` record produced by each decided case — the training
substrate that lets some future decisions be automated.

### Automation policy
A rule on a gate describing when a decision may be made by `system:auto` instead
of a human — e.g. only when checks pass and the value is below a ceiling.

### Operational truth layer
The category Open Gates occupies: the layer where real operations become
verifiable, executable, and automatable, anchored on the acceptance of facts.

### Applied Systems Builder
The developer role Open Gates promotes: someone who goes into a real business,
finds its **gates**, and builds digital contours around them — rather than
starting from an app.
