# Spatial evidence & AR/LiDAR — foundational architecture

> Status: **design draft (v0).** Forward-looking. Nothing here is built yet; it
> sets the contracts so the visualization work and a future AR/LiDAR capture app
> fit the same engine without re-architecting. Read [`SPEC.md`](../../SPEC.md)
> §7.5 (zones as anchors) and [`packages/engine/src/zones.ts`](../../packages/engine/src/zones.ts)
> first.

## 1. Why this is foundational, not a feature

Open Gates' defining check is **claim vs reality within a tolerance**
(`cross_check`). Today "reality" is a scalar — a survey says 117 m³ against a
claimed 120. LiDAR makes reality **geometry**: a foreman standing in a zone
captures the *as-built* 3D, and that capture is the evidence the claim is checked
against. So AR/LiDAR is not a UI skin on the viewer — it changes three things at
the core:

- **Evidence** stops being a scalar and becomes **geometry**.
- **Zone** stops being a logical id and becomes a **spatial identity** that a
  field device must bind to, on site, with some level of trust.
- **Trust** becomes load-bearing: acceptance assigns liability, so a capture must
  be attributable, tamper-evident, and provably *of the zone it claims*.

## 2. The invariant we refuse to break

`fold(gate, events) → state` stays a **pure, deterministic, dependency-free**
function. No point cloud, mesh, or registration math ever enters the engine.

We hold the invariant with one move: **evidence-by-reference + derived features.**
The heavy, non-deterministic work (scan registration, volume, deviation) happens
at the edge; only its *output* — a content-addressed `ref` plus scalar
`features` — enters the append-only log. The engine checks the features. Raw
geometry lives in an artifact store the engine never reads.

```
        EDGE (impure, heavy, scalable)              ENGINE (pure, tiny, deterministic)
  scan ─► register vs plan ─► features ──┐
                                          └─► evidence.attached{ ref, features } ─► fold() ─► checks
  raw artifact ─► artifact store (by hash)                                                    │
                                                                                              ▼
                                                                              accepted fact + consequences
```

## 3. Data model

### 3.1 Events (extends today's log — still append-only, never mutated)

- `claim.submitted` — gains an optional `zone` and the asserted quantity it
  claims is done (e.g. `volumeM3: 120`).
- `evidence.attached` — gains a **capture manifest** when the evidence is a scan:

```jsonc
{
  "kind": "lidar_scan",
  "ref": "blake3:9f2c…",            // content address of the raw artifact
  "format": "usdz",                  // usdz | glb | e57 | ply | obj
  "features": {                      // derived OFF-engine; the only thing fold() reads
    "volumeM3": 117.4,
    "coveragePct": 0.96,             // how much of the zone the scan actually covers
    "meanDeviationM": 0.012,         // as-built vs planned
    "maxDeviationM": 0.041,
    "deviceAccuracyM": 0.01,         // sensor/scan accuracy class
    "scannedAt": "2026-06-23T09:14:00Z",
    "processorVersion": "geomproc@1.4.0"
  },
  "binding": {                       // ZoneBinding — see §6
    "zoneId": "A1-F03",
    "method": "fiducial",            // fiducial | icp_to_plan | world_anchor | manual | geospatial
    "confidence": 0.98,
    "pose": { "t": [12.1, 3.0, 7.4], "r": [..] },   // capture pose in model frame
    "transform": [/* 4x4 scan→model */]
  },
  "provenance": {
    "capturedBy": "foreman:petrov",
    "deviceId": "ipad-pro-7f3",
    "appVersion": "capture@0.3.1",
    "sig": "v1.<claims>.<hmac>"      // signs (ref + binding + scannedAt + capturedBy)
  }
}
```

The engine sees `features`, `binding.{method,confidence,pose}`, and
`provenance.sig` validity — **never** the artifact. `decision.recorded` is
unchanged.

### 3.2 Stores (all off-engine)

- **Artifact store** — content-addressed blobs (raw scan, the deviation heatmap,
  a thumbnail), keyed by hash, immutable. S3/MinIO/local volume.
- **Model registry** — the *planned* geometry per site, **versioned**.
  `viz/model/building.json` today; IFC/BIM later. A zone resolves here to its
  planned geometry + frame. Evidence is bound to a *model version*.
- **Geometry processor** — stateless workers that take (raw scan + planned model
  + claimed zone) → registration, `features`, heatmap. Idempotent, keyed by scan
  hash; records `processorVersion`. Its output becomes the `evidence.attached`
  features. **Re-processing is a new evidence event, never a mutation** — that is
  what keeps the engine's determinism intact.

## 4. New checks (pure functions of features — they fit the engine perfectly)

| Check | Passes when | Guards against |
|-------|-------------|----------------|
| `geometry_cross_check` | `|claimQty − scanQty| / claimQty ≤ tolerance` | over-claiming volume/area |
| `coverage` | `coveragePct ≥ min` | scanning a corner and claiming the room |
| `capture_accuracy` | `deviceAccuracyM ≤ max` | accepting high-value work on a noisy scan |
| `pose_in_zone` | capture `pose` ∈ claimed zone bounds | scanning zone A, claiming zone B |
| `freshness` | `scannedAt` within N h of the claim | replaying an old/borrowed scan |
| `binding_trust` | `binding.confidence ≥ min` **for this gate's value** | a cheap manual pick accepting expensive work |
| `provenance_signed` | `sig` valid & capturer authorized for domain/zone | anonymous or forged captures |

`binding_trust` is policy-driven: a gate may require *fiducial-grade* binding for
high-value acceptances and allow *manual+ICP* for low-value ones — the spatial
analogue of today's `autoAcceptWhen.maxAmount` ceiling.

## 5. Service boundaries & data flow

```
┌─────────────────────────── on site (maybe offline) ───────────────────────────┐
│  Capture client (iOS LiDAR / ARCore)                                            │
│   • AR overlay rendered from a cached PROJECTION (accepted=green / pending)      │
│   • LiDAR scan ─► localize ─► ZoneBinding{method,confidence,transform}           │
│   • sign manifest{ scanHash, binding, claimQty, capturedBy, ts }                 │
│   • enqueue locally (offline-first)                                              │
└───────────────┬─────────────────────────────────────────────────────────────────┘
                │ connectivity returns
                ▼
   upload artifact ─► Artifact store (by hash)
                │
                ▼
   POST /queue { gate, events:[ claim.submitted(zone, claimQty),
                                 evidence.attached(manifest) ] }   ← existing push queue
                │
                ▼
   Geometry processor (workers): register scan↔plan, compute features + heatmap,
                                  append evidence features
                │
                ▼
   Open Gates ENGINE (pure): fold ─► geometry_cross_check / coverage / pose_in_zone /
                              accuracy / binding_trust / provenance ─► consequences
                │                         │
                │ policy permits          │ needs a human
                ▼                         ▼
            autodecide              Reviewer leases (existing queue): sees scan,
                                    heatmap, deviation, binding trust ─► decides (signed)
                │                         │
                └────────────┬────────────┘
                             ▼
        accepted fact: money + right_to_proceed + risk + dataset_label
                             ▼
                 PROJECTION updates ─► three.js viewer AND AR overlay turn the zone
                                       green, in place
```

Boundaries: **engine** (pure, unchanged: library / Vercel `/fold` / Docker),
**review queue** (existing push & pull; carries refs + binding now), **artifact
store**, **geometry processor** (new, scalable, async), **model registry**,
**projection service** (thin: engine projection over states + model →
canonical view), **capture client** (new), **identity** (existing signed tokens,
extended with a `capturer` subject + per-device keys).

The capture client and the three.js viewer are **two renderers over ONE
projection** — and the capture client is additionally a **capturer**. That is the
whole reason to design the projection contract now.

## 6. Spatial identity & localization (the crux)

Given a field device pose, produce a `ZoneBinding{ zoneId, method, confidence,
transform }`. The method determines trust; the gate decides how much trust it
needs.

| Method | Trust | Site prep | Offline | Weakness |
|--------|:----:|:--------:|:------:|----------|
| **manual + ICP-to-plan** | low–med | none | ✓ | trusts the human's pick; ICP mis-converges in symmetric/empty rooms |
| **fiducials (QR/AprilTag)** | high | place + survey markers once | ✓ | markers can move/damage; one-time prep |
| **world anchors / relocalization** (ARWorldMap, ARCore Cloud/Geo) | med | a mapping pass | ✗ (cloud) / ~ | indoor drift, fragile persistence, vendor lock, often needs network |
| **geospatial GNSS + floor** | coarse | none | ✓ | useless indoors for sub-metre zones; only a *prior* to pick building/floor |
| **survey control points + IFC georef** | gold | total-station survey | ✓ | expensive; construction-grade only |

**Decision: layered, not one-of.** Always-available fallback = *manual + ICP*.
Escalate to *fiducials* where acceptance value demands it (enforced by
`binding_trust` policy). Use *geospatial* as a coarse prior and *world anchors*
as a convenience for revisits. The binding's `method` + `confidence` travel in
the manifest and are **checkable**, so trust is explicit and policy-driven rather
than assumed. This is the single most important contract to get right — every
downstream guarantee rests on "is this capture really *of this zone*?"

## 7. Reconciliation: planned vs claimed vs as-built

Three geometries now meet at a zone:

- **planned** — design/BIM (the target).
- **claimed** — what the foreman asserts is done.
- **as-built** — the scan.

The gate accepts when **as-built reconciles with claimed** within tolerance
**and** as-built conforms to **planned** within tolerance. Deviations within a
noted band → `accepted_with_exceptions` (the heatmap is the caveat); beyond
tolerance → `returned_for_rework` with the heatmap as the reason. The dataset
label records `(planned, claimed, as-built, deviation, decision)` — the richest
possible substrate for future **auto-acceptance**.

## 8. Trust, provenance, anti-spoof

Acceptance = liability, so the capture chain must be hard to forge:

- **Tamper-evident** — the manifest signature covers `scanHash + binding +
  scannedAt + capturedBy`; swapping the artifact breaks the hash.
- **Attributable** — `capturedBy` is a signed subject (extend the existing
  reviewer-token scheme to a **capturer** role + per-device keys), not a string.
- **Of-the-zone** — `pose_in_zone` + `coverage` make "scan A, claim B" and
  partial scans fail closed.
- **Fresh** — `freshness` defeats replay of an old or borrowed scan.
- **Trust-gated by value** — `binding_trust` ties required localization grade to
  the money at stake.

All of these are *features the engine checks*; none require the engine to see
geometry.

## 9. Offline-first

Sites have bad connectivity. Capture, localize, sign, and queue must work fully
offline; sync later. The existing **push queue** already models
pending→leased→decided, and sync is **idempotent by scan hash**, so a flaky
upload that retries can't double-enqueue. Nothing about capture blocks on the
network; only submission does.

## 10. Platform & formats

- **Capture** — iOS **ARKit** (RoomPlan for rooms; scene-reconstruction
  `ARMeshAnchor` generally; true LiDAR on Pro). Android **ARCore Depth**
  (ToF/depth-from-motion, *no* true LiDAR → lower accuracy, gated by
  `capture_accuracy`).
- **Interchange** — **USDZ** (Apple-native, AR Quick Look), **glTF/GLB**
  (cross-platform render; the three.js viewer), **E57/LAS/PLY** (point clouds),
  **OBJ** (today's export), **IFC** (BIM / planned model).
- **Anchors** — ARWorldMap / ARGeoAnchors (iOS); ARCore Cloud/Geospatial Anchors
  (cross, needs cloud).

The engine is format-agnostic (refs + features); processor and renderers own the
formats. **Recommendation: iOS-LiDAR-first** (true depth, RoomPlan, USDZ); treat
Android as a later, accuracy-gated tier.

## 11. Failure modes

| Failure | Mitigation |
|---------|-----------|
| Mis-localization → wrong zone accepted | `pose_in_zone` + `coverage` + `binding_trust` policy + reviewer sees the overlay |
| Scan spoof / replay | signed pose+timestamp, device key, `freshness`, `pose_in_zone` |
| Partial / occluded scan | `coverage` fails → returned, not silently accepted |
| Low-accuracy device | `capture_accuracy` gates high-value work |
| Connectivity loss | offline queue; idempotent sync by hash |
| Artifact store outage / loss | features (in the log) are the decision's source of truth; artifact is for human audit → replicate the store |
| Processor non-determinism (ICP) | pin seed + `processorVersion`; features immutable once logged; re-process = new event |
| Coordinate drift over a large site | control points / fiducials; per-floor frames |
| Stale planned model | version the model; bind evidence to a model version |

## 12. Phased plan (today → full AR/LiDAR)

- **Phase 0 — done.** Snapshot viewer reads `attachments.json`. ✓ merged.
- **Phase 1 — projection contract + evidence-by-reference (engine only).**
  Generalize `indexByZone` → `project(states, model) → view`; make evidence carry
  `ref` + `features`; add the geometry checks (§4) and `ZoneBinding` as a
  checkable feature (§6). Pure, tested, specced. **No AR yet — but designed so AR
  cannot require re-architecting.** *This is the re-scoped visualization task.*
- **Phase 2 — two-way web loop.** Viewer submits real claims (`POST /queue`) with
  a manually uploaded scan file processed into features; acceptance flows back.
  Proves the loop with no mobile app.
- **Phase 3 — capture client (iOS LiDAR, manual-pick + ICP).** On-device scan →
  features → submit; AR overlay renders the projection in place; offline queue;
  signed manifests.
- **Phase 4 — trust hardening.** Fiducials for high-value zones, `binding_trust`
  policy in gates, device keys, freshness/replay defenses, georeference/control
  points.
- **Phase 5 — generality & automation.** Non-spatial "maps" (board renderer),
  Android tier, BIM/IFC ingestion, auto-acceptance trained on the
  `(planned, claimed, as-built → decision)` dataset.

## 13. Open decisions (need a human call)

1. **Primary platform** — iOS-LiDAR-first (recommended) vs cross-platform from
   day one. Forks the capture client and accuracy story.
2. **Default localization** — ship Phase 3 on manual+ICP and add fiducials in
   Phase 4 (recommended), or require fiducials from the first capture (higher
   trust, slower rollout, site prep).
3. **Build scope now** — build Phase 1 immediately (it is the foundation *and*
   unblocks the viewer two-way loop) and keep Phases 2–5 as design;
   vs design-only for now.
4. **Trust strength for v1** — is signed-manifest + pose/coverage/freshness
   enough, or do high-value acceptances need fiducial-grade binding before any
   pilot?

## 14. The throughline

Keep `fold()` pure. Push geometry to the edge as **content-addressed evidence +
derived features**. Make **`ZoneBinding{method, confidence, transform}`** a
first-class, *checkable* feature so the engine reasons about *trust in the
spatial claim* without touching a point cloud. Then AR/LiDAR is simply the
highest-fidelity **capturer + renderer** over the one **projection contract** the
three.js viewer already uses. Design that contract now (Phase 1); AR slots in
later with no re-architecting.
