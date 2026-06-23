# Standards

Open Gates maps its data onto established standards. These are **mappings, not dependencies**: the engine has no runtime coupling to any of them, and a gate is meaningful on its own. But the same gate can speak formats that existing software — and AI agents — already read. A `decision.recorded` event is a row in a provenance graph, a row in a decision table, an earned-value line, and a metrology decision rule at the same time, without exporting anything new.

Two tiers. **Load-bearing** mappings are exercised by the reference engine and the construction example; the field column points at real symbols. **Decorative-until-enforced** mappings are honest placeholders: the data carries the reference, but nothing in the engine validates it yet.

## Load-bearing

These standards describe how the engine already behaves. Each row maps a standard onto concrete fields and symbols in [`engine/src`](engine/src) and the construction example.

| Standard (identifier) | What it governs | Field-level mapping in Open Gates |
| --- | --- | --- |
| **W3C PROV-O** ([w3.org/TR/prov-o](https://www.w3.org/TR/prov-o/)) | Provenance of an accepted fact | `claim.submitted` → `prov:Entity`; each `evidence.attached` is `prov:used` by the survey `prov:Activity`; surveyor and reviewer → `prov:Agent`; `decision.recorded` → a `prov:Activity` that is `prov:wasAssociatedWith` the reviewer; the event log (`GateState.log`) → a `prov:Bundle`. Serialization below. |
| **OMG DMN 1.4** (2022) | The check logic | `gate.checks` is a decision table. Each check is a rule row (input: claim vs. reference; output: pass/fail). `checksPassed` is the table's aggregated hit. Tolerance + uncertainty are the input expressions. See [`engine/src/checks.ts`](engine/src/checks.ts). |
| **JCGM 100:2008 (GUM)** | Measurement uncertainty | Expanded uncertainty `U = k·u`. Construction: `U = 4 m³` at `k = 2` (~95%). The survey's `U` is evidence, carried into the check, not invented by the gate. |
| **JCGM 200:2012 (VIM §2.16)** | Error against a reference | The check computes error as `|claim − reference|` against the **trusted reference** (the independent survey), not against the claim. Construction: `|120 − 117| = 3 m³ = 2.56%` of the 117 m³ reference. |
| **ISO/IEC 17025:2017 §7.8.6** | The decision rule | The accept/dispute boundary is a stated decision rule: accept when error ≤ tolerance **and** within `U`. `3 m³` is within the `5%` tolerance and within `U = 4 m³` → accept the surveyed `117`, not the claimed `120`. `20 m³` (dispute) is beyond both → return for rework. |
| **ANSI/EIA-748 (EVM)** | Earned value | Money is paid on the **accepted** quantity: `accepted_qty × rate = BCWP`. Construction: `117 × €85 = €9,945` gross BCWP — never `120 × €85`. The accepted quantity flows from `decision.acceptedValues` → surveyed reference → claim. See [`engine/src/consequences.ts`](engine/src/consequences.ts). |

The numbers are recomputable from one accepted line:

```
reference   = 117 m³        (independent survey; claim was 120 m³)
error       = |120 − 117|   = 3 m³ = 2.56% of 117   (VIM §2.16)
within U?   = 3 ≤ U=4 m³    → yes  (GUM, k=2)
within tol? = 2.56% ≤ 5%    → yes  → ACCEPT 117      (ISO/IEC 17025 §7.8.6)
gross       = 117 × €85     = €9,945                 (ANSI/EIA-748 BCWP)
retention   = 5% × €9,945   = €497.25
net         = €9,945 − €497.25 = €9,447.75
vat (memo)  = 20% × €9,447.75 = €1,889.55
```

## Decorative-until-enforced

The data model carries these references so downstream tools can resolve them, but **the engine does not yet validate them**. Treat a present reference as a label, not a guarantee. Listed here so the gap is explicit rather than implied.

| Standard (identifier) | Intended mapping | Status |
| --- | --- | --- |
| **ISO 19650-1/-2:2018** | CDE deliverable references attached via `evidence.ref` | Reference is stored; **not validated** — the engine does not resolve or verify the CDE pointer. |
| **IFC = ISO 16739-1:2024** | `IfcElement` `GlobalId` identifying the accepted element | Identifier is carried on evidence; **not validated** — no IFC parsing or GlobalId check. |
| **ISO 9001:2015 §8.6** | Release-of-product control (the gate as the release point) | Conceptual alignment only; **not enforced** — no conformance assertion is made or checked. |

## PROV-O serialization (construction accepted case)

The accepted case from [`examples/construction/scenario.accept.json`](examples/construction/scenario.accept.json), serialized as PROV-O JSON-LD. The event log is a `prov:Bundle`; the surveyor and supervisor are `prov:Agent`s; the survey is a `prov:Activity` that `prov:used` the evidence; `decision.recorded` is a `prov:Activity` `prov:wasAssociatedWith` the supervisor.

```json
{
  "@context": { "prov": "http://www.w3.org/ns/prov#", "og": "https://opengates.dev/ns#" },
  "@id": "og:case/excavation-117",
  "@type": "prov:Bundle",
  "@graph": [
    { "@id": "og:claim/excavation-117", "@type": "prov:Entity",
      "og:quantity": "120 m3", "og:rate": "85 EUR/m3", "og:estimateLine": "ФЕР06-01-001-01" },
    { "@id": "og:agent/surveyor", "@type": "prov:Agent",
      "og:role": "surveyor", "og:instrument": "Leica TS16", "og:calibration": "on-file" },
    { "@id": "og:agent/supervisor", "@type": "prov:Agent", "og:role": "supervisor" },
    { "@id": "og:evidence/survey", "@type": "prov:Entity",
      "og:reference": "117 m3", "og:expandedUncertainty": "U=4 m3 (k=2, ~95%)" },
    { "@id": "og:activity/survey", "@type": "prov:Activity",
      "prov:used": { "@id": "og:evidence/survey" },
      "prov:wasAssociatedWith": { "@id": "og:agent/surveyor" } },
    { "@id": "og:activity/decision", "@type": "prov:Activity",
      "prov:used": { "@id": "og:claim/excavation-117" },
      "prov:wasAssociatedWith": { "@id": "og:agent/supervisor" },
      "prov:generated": { "@id": "og:fact/accepted-117" } },
    { "@id": "og:fact/accepted-117", "@type": "prov:Entity",
      "prov:wasGeneratedBy": { "@id": "og:activity/decision" },
      "og:outcome": "accepted", "og:acceptedQuantity": "117 m3",
      "og:grossEUR": 9945.00, "og:netCertifiedEUR": 9447.75 }
  ]
}
```

---

Linked from [`README.md`](README.md) (Standards) and [`SPEC.md`](SPEC.md) §9.
