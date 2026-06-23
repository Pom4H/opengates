# Roadmap

Things that are **not built yet** — kept out of the [README](README.md) ladder so
it only advertises what runs. Each item is a direction, not a promise; no dates.

**Shipping today:** the deterministic [`fold`](engine/src/fold.ts) engine, the
[review queue](engine/src/queue/) (fencing leases, SLA, delegation trail),
[OAuth 2.1 auth](engine/src/auth.ts), the [MCP server](engine/src/mcp/), real
[standards mappings](STANDARDS.md), and two worked gates —
[construction](examples/construction/) and [logistics](examples/logistics/).
Everything below is beyond that line.

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

## A hosted service

A managed deployment of the queue + MCP surface with real OAuth (JWKS, not the
bundled HS256 verifier), per-tenant isolation, and a durable event store beyond
the file snapshot — for teams that want the gate without self-hosting.
