# Resource flow & multi-domain visualization — foundational architecture

> Status: **design draft (v0).** Forward-looking. Nothing here is built yet; it
> sets the contracts so a richer construction picture (materials, people,
> rented machines → capital structures) and *other domains* (logistics,
> finance) all sit on one engine without re-architecting. Read
> [`SPEC.md`](../../SPEC.md) §7.5 (zones as anchors),
> [`packages/engine/src/zones.ts`](../../packages/engine/src/zones.ts), and
> [`viz/README.md`](../../viz/README.md) first. Companion draft:
> [`spatial-evidence-and-ar.md`](spatial-evidence-and-ar.md).

## 1. The problem this solves

Today the spatial view shows the **output** only: a building grid where each
zone is coloured by how many of four systems (structure → envelope → MEP →
fit-out) have been *accepted*. It answers "what is built", not "out of what".

We now want to also see and control the **inputs and their flow**:

- **move materials** to site (rebar, concrete, panels);
- **move people** on a vehicle (a crew to a zone);
- **rent special equipment** (crane, concrete mixer) by the hour;
- **build capital structures and systems** by *consuming* those resources.

And we want this without inventing a construction-only model — the same shapes
must carry **logistics** (the transport and rental legs) and **finance** (the
money every acceptance certifies), because those domains are already in the
repo ([`examples/logistics/`](../../examples/logistics)) and more are coming
([`ROADMAP.md`](../../ROADMAP.md)).

## 2. The invariant we refuse to break

`fold(gate, events) → state` stays a **pure, deterministic, dependency-free**
function, and the spatial promise holds: **the thing you click is the fact the
engine accepted** ([README](../../README.md), [`viz/README.md`](../../viz/README.md)).

We extend the *picture*, not the engine. The one rule that makes the new picture
trustworthy:

> **Every edge in the visualization is gate-backed.** A flow of material, a crew
> ride, a crane rental, a system erected, a payment — each is one **Acceptance
> Act** with a `caseId`. An edge's colour/width is *derived* from its case's
> acceptance state; it is never hand-set. No accepted gate, no solid edge.

That is the whole trick: resources, transport, and rentals become first-class on
the map precisely because each is already the unit Open Gates owns — a claim that
becomes an accepted fact.

## 3. Layered architecture

Six layers, each ignorant of the one above it. Construction, logistics and
finance enter only at L2; everything below is domain-agnostic.

```
 L5  Live substrate     Visualizer MCP knowledge graph → streams to subscribed UIs
 L4  Views              Spatial(3D) · Flow(Sankey) · Map(routes) · Finance(EVM) · Timeline
 L3  Projections        indexByZone · resourceLedger · flowGraph · costRollup   (pure read models)
 L2  Domain packs       Construction · Logistics · Finance   (plugins: gate.json + kinds + adapters)
 L1  Operational graph  Anchor (zone|resource|actor|account)  +  Flow (gate-backed edge)
 L0  Acceptance core    fold(gate, events) → state            (pure, knows nothing of cranes/zones/€)
```

### L0 — Acceptance core (unchanged)

The existing engine. Pure fold, cross-check against a reference, consequences
fired exactly once. It is what every domain *shares*; it never learns a single
construction or logistics word.

### L1 — Operational graph (the generalization)

Today's spatial layer has two primitives we widen into a small, domain-agnostic
**property graph**:

- **`zone`** → **`Anchor`**. A zone is one kind of anchor (a place). The general
  anchor is *anything a fact can pin to*, with `kind ∈ { zone, resource, actor,
  account }`. Zones stay exactly as they are (non-normative, `building.json`);
  the other kinds are new nodes.
- **`indexByZone`** (claim→zone inversion) → **`Flow`**. The general edge is a
  gate-backed flow between anchors.

A **Resource** anchor carries a *conservation discipline*, which is the only
genuinely new modelling idea — and it is just the `cross_check` principle applied
to stock instead of to a survey:

| `resourceKind` | example | discipline | what the lint checks |
|---|---|---|---|
| `material` | rebar, concrete | **consumable** (mass balance) | `Σ accepted-in ≥ Σ consumed-out` per resource |
| `labor` | a concrete crew | **consumable flow** (man-hours) | transported-in hours ≥ booked hours |
| `equipment` | crane, mixer | **leasable / reusable** (capacity) | no overlapping rentals of the same unit (double-booking) |

These cross-case rules live next to today's `lintZones` (`unknown_zone`,
`duplicate_acceptance`) — same family: *invariants a single in-case check can't
see*.

### L2 — Domain packs (plugins — how "other domains" stay clean)

A domain is a **plugin**, never a core dependency. Each pack provides:

1. **gate definitions** — `gate.json` files (already how construction & logistics
   work);
2. **anchor & flow kinds** it introduces;
3. **projections** (L3) and **view adapters** (L4) it contributes.

The dependency rule is one-directional: **core ← domain**. The core imports no
domain; domains import the core. Adding "agriculture" or "healthcare"
([catalog](../../examples/CATALOG.md)) means dropping in a pack, not touching L0/L1.

| pack | anchors it adds | flow kinds | gate (existing) |
|---|---|---|---|
| **Construction** | `capital_work` (a system in a zone) | `consume`, `produce` | [`construction/systems/gate.json`](../../examples/construction/systems/gate.json) |
| **Logistics** | `source` (supplier, depot, rental yard), `vehicle` | `deliver`, `rent`, `return` | [`logistics/gate.json`](../../examples/logistics/gate.json) |
| **Finance** | `account` | `pay` | `money` consequence (today) → a `finance.payment` gate |

### L3 — Projections (read models, generalizing `indexByZone`)

Pure functions folding accepted facts into view-ready shapes. Each is
independently testable and cacheable, and each writes a JSON the way
`indexByZone` already writes [`attachments.json`](../../viz/model/attachments.json):

- **`indexByZone`** *(exists)* — per zone: works, documents, rollup → spatial view.
- **`resourceLedger`** — per resource: `ordered / delivered / accepted / consumed
  / remaining` (the mass-balance, straight from accepted `deliver` and `consume`
  flows).
- **`flowGraph`** — nodes + gate-backed edges → the Sankey / network view.
- **`costRollup`** — per account/project: certified net, retention, BCWP (EVM) →
  the finance view.

### L4 — Views (many renderers, one truth)

The existing rule — "the selector, the OBJ export and the animation never
disagree because they read one canonical model" — generalizes to: **every view
reads a projection, never raw events.** So they cannot drift.

- **Spatial (3D)** *(exists)* — `viz/viewer`, zones coloured by `systemsDone`.
- **Flow / Sankey** — resources `source → goods-in → zone-system`; edge width =
  quantity, colour = acceptance status. The new headline view for "out of what".
- **Map / routes** — logistics: `deliver`/`rent` flows in transit on a map.
- **Finance / EVM** — `pay` flows and earned-value curves from `costRollup`.
- **Timeline / Gantt** — `arrival` + system `lag` (already in `building.json`).

### L5 — Live substrate

The **Visualizer MCP** knowledge graph is the runtime surface for the cross-domain
*whole-operation* picture: as each gate accepts, the corresponding node/edge
updates and streams to subscribed UIs in real time. The static spatial viewer and
the live graph are two L4/L5 renderers of the same L3 projections.

## 4. Data shapes (sketch — additive, nothing existing changes)

The spatial model stays canonical. We add an **optional overlay**
`viz/model/graph.json` for the non-spatial anchors, referencing zones by id.

```jsonc
// nodes — anchors
{ "id": "SUP-rebar",  "kind": "actor",    "subtype": "supplier",    "domain": "logistics", "label": "Rebar supplier" }
{ "id": "YARD-crane", "kind": "actor",    "subtype": "rental_yard", "domain": "logistics" }
{ "id": "MAT-rebar",  "kind": "resource", "resourceKind": "material",  "unit": "t",         "consumable": true }
{ "id": "CREW-conc",  "kind": "resource", "resourceKind": "labor",     "unit": "man-h" }
{ "id": "EQ-crane-1", "kind": "resource", "resourceKind": "equipment", "unit": "machine-h", "leasable": true }
{ "id": "B2-F03",     "kind": "zone" }                                   // lives in building.json
{ "id": "SYS-B2-F03-structure", "kind": "capital_work", "system": "structure", "zone": "B2-F03" }
{ "id": "ACC-project",          "kind": "account",     "domain": "finance" }

// edges — flows. EVERY edge carries a caseId and derives its state from that case.
{ "id": "f-201", "kind": "deliver", "from": "SUP-rebar",  "to": "MAT-rebar",  "qty": 24,  "unit": "t",
  "case": "logistics.delivery#88",         "status": "accepted" }     // claim 24t vs weighbridge 23.8t
{ "id": "f-202", "kind": "rent",    "from": "YARD-crane", "to": "EQ-crane-1", "qty": 40,  "unit": "machine-h",
  "case": "logistics.rental.crane#9",      "status": "accepted" }     // hours vs telematics
{ "id": "f-203", "kind": "deliver", "from": "DEPOT",      "to": "CREW-conc",  "qty": 64,  "unit": "man-h",
  "case": "logistics.crew-transport#12",   "status": "accepted" }
{ "id": "f-204", "kind": "consume", "from": "MAT-rebar",  "to": "SYS-B2-F03-structure", "qty": 3.2, "unit": "t" }
{ "id": "f-205", "kind": "produce", "from": "SYS-B2-F03-structure", "to": "B2-F03",
  "case": "construction.zone-system#42",   "status": "accepted" }     // existing construction gate
{ "id": "f-206", "kind": "pay",     "from": "ACC-project", "to": "SUP-rebar", "amount": 95280, "currency": "EUR",
  "case": "finance.payment#7",             "status": "accepted" }     // money consequence of f-201
```

Projection outputs sit beside the existing one:

```
viz/model/building.json        (canonical spatial — unchanged)
viz/model/graph.json           (NEW optional overlay: non-spatial anchors)
viz/model/attachments.json     (indexByZone        — exists)
viz/model/flows.json           (flowGraph          — NEW)
viz/model/ledger.json          (resourceLedger     — NEW)
```

## 5. One worked path across all three domains

A single rebar story, touching logistics → construction → finance through **one
shared acceptance core**:

```
 [Rebar supplier] --deliver(24t)--> [MAT-rebar] --consume(3.2t)--> [SYS structure @B2-F03] --produce--> [Zone B2-F03]
       │ logistics.delivery#88            │ mass balance              │ construction.zone-system#42       │ turns "structure done"
       │ accept 24t vs weighbridge 23.8t  │                           │ accept vs inspection              │
       ▼                                                              ▼
 [finance.payment#7] <----------------- pay (money consequence) --------------- accepted_qty × rate = BCWP
                                                                                      ▲
 [Crane yard] --rent(40 machine-h)--> [EQ-crane-1] --use--> [SYS structure @B2-F03]  │  (parallel input)
       │ logistics.rental.crane#9: hours vs telematics                              ─┘
```

Three domains, three gate definitions, **zero** changes to L0. Click any edge →
its gate case (claim, evidence, decision, money, owner). Click the zone → every
work and document anchored there, exactly as today.

## 6. Why this fits Open Gates (and what it deliberately is not)

- **It reuses the unit.** A delivery, a rental hour, a system, a payment — all are
  already "claim meets reference meets role". We add *kinds of anchor and flow*,
  not a second decision model.
- **It keeps the engine pure.** Conservation/double-booking are **cross-case
  lints** at L1, the same shape as `lintZones` — never inside `fold`.
- **It keeps views honest.** Every view reads a projection; colour is derived from
  acceptance, so the Sankey, the 3D and the finance curve are one truth.
- **It is not** an inventory system, a fleet-management tool, or an ERP. It is the
  *acceptance boundary* under those things, given a spatial and a flow surface.

## 7. Phased plan

1. **Ontology (L1).** Land `Anchor`/`Flow` types and `graph.json` overlay; port
   `zone` to be `kind:"zone"`. No behaviour change.
2. **Projections (L3).** `resourceLedger` + `flowGraph` from accepted flows;
   conservation/double-booking lints beside `lintZones`.
3. **Flow view (L4).** A Sankey reading `flows.json` — the "out of what" picture,
   each edge a gate.
4. **Logistics & finance packs (L2).** A `logistics.rental` gate (machine-hours vs
   telematics) and a `finance.payment` gate; wire `deliver`/`rent`/`pay`.
5. **Live substrate (L5).** Stream node/edge updates into the Visualizer graph as
   gates accept.
