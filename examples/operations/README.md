# Operations — resource flows feeding a zone

The construction map shows *what is built*. This worked example shows **out of
what**: materials, people and rented machines flowing in, and being drawn down
into a capital work — every flow a gate, the same Acceptance Act the rest of Open
Gates is built on. Design: [`docs/architecture/resource-flow-and-domains.md`](../../docs/architecture/resource-flow-and-domains.md).

One generic gate ([`flow.gate.json`](flow.gate.json), domain `operations`) carries
any resource flow; a domain pack (logistics, finance) specializes the reference it
cross-checks against. Each scenario's claim carries `flowKind`, `resource`, `qty`,
`from`, `to`.

| scenario | flow | reads as |
|---|---|---|
| [`deliver-rebar.accept.json`](deliver-rebar.accept.json) | `deliver` | supplier → rebar stock, **accepted 23.8 t** vs weighbridge (claimed 24) |
| [`rent-crane.accept.json`](rent-crane.accept.json) | `rent` | yard → tower crane, **accepted 39.5 machine-h** vs telematics |
| [`transport-crew.accept.json`](transport-crew.accept.json) | `deliver` | depot → concrete crew, 64 man-h |
| [`consume-rebar.json`](consume-rebar.json) | `consume` | rebar → structure (3.2 t) |
| [`consume-crane.json`](consume-crane.json) | `consume` | crane → structure (8 machine-h) |
| [`consume-crew.json`](consume-crew.json) | `consume` | crew → structure (16 man-h) |

Folded together with the existing construction acceptance
([`../construction/systems/structure.accept.json`](../construction/systems/structure.accept.json),
read as a `produce` edge → zone A1-F03), they form one cross-domain path:

```
[Rebar supplier] --deliver--> [Rebar] --consume--> [Structure · A1-F03] --produce--> [Zone A1-F03]
[Crane yard]     --rent-----> [Crane]  --consume-->        ▲
[Crew depot]     --deliver--> [Crew]   --consume-->        ┘
```

Run it — print the graph, the per-resource ledger (accepted in vs. consumed out),
and the cross-case lint; and write the two projection files the flow view reads:

```bash
npm run demo:flows     # print flows + ledger + validation
npm run viz:flows      # also write viz/model/flows.json + ledger.json

python3 -m http.server 8099    # then open /viz/flow/  — click any edge or resource
```

The ledger uses the **accepted** quantity, not the claim (rebar in = 23.8 t, not
24): stock on reality, the same principle as the money. Over-consume a resource
and `lintFlows` flags `negative_stock`; reference an anchor the model lacks and it
flags `unknown_anchor` — the cross-case siblings of `lintZones`.
