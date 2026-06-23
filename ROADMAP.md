# Roadmap

Directions for the **non-normative** side of Open Gates — the reference
implementation, its runtime tooling, and products built on the standard. None of
this is part of the spec; the standard is [`SPEC.md`](SPEC.md) +
[`conformance/`](conformance/). Each item is a direction, not a promise; no dates.

**Shipping today** — the deterministic [`fold`](packages/engine/src/fold.ts), plus,
as **runtime tooling that is not part of the standard**, a
[review queue](packages/engine/src/queue/) (fencing leases, SLA, delegation trail),
[OAuth 2.1 auth](packages/engine/src/auth.ts), and an
[MCP server](packages/engine/src/mcp/). On the normative side: real
[standards mappings](STANDARDS.md), a [conformance suite](conformance/), and two
worked gates — [construction](examples/construction/) and
[logistics](examples/logistics/). Everything below is beyond that line.

## More worked verticals

The [catalog](examples/CATALOG.md) lists five gates — manufacturing, retail,
agriculture, healthcare, insurance — in the same claim-meets-reference-meets-role
shape. None yet has a `gate.json` + scenarios; each graduates to a worked example
when it does. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Standards: more load-bearing, less decorative

[`STANDARDS.md`](STANDARDS.md) marks ISO 19650 / IFC (ISO 16739-1) and ISO 9001
§8.6 as *decorative until enforced*. Making them load-bearing means validating
`evidence.ref` against a CDE deliverable and an `IfcElement` GlobalId, and
emitting the event log as a signed PROV-O bundle a third party can verify.

## A construction vertical

A thin product around the construction gate: КС-2 intake, обмер capture, a
КС-3 certificate out of the accepted quantities, retention tracking across a
defects-liability period. The gate is the engine; this is the surface.

## A product (hosted service)

**A product, not the standard** — a fork's job, listed here only so the boundary
is explicit. A managed deployment of the reference impl's queue + MCP surface:
real OAuth (JWKS, not the bundled HS256 verifier), per-tenant isolation, and a
durable event store beyond the file snapshot — for teams that want the gate
without self-hosting. The standard itself stays runtime-agnostic.
