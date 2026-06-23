// Zones as anchors.
//
// A zone (a place in a spatial model — see viz/) is not just a field on a
// claim; it is an anchor that work, documents and other facts attach to. A
// claim references a zone via a field of kind "zone"; this module inverts that
// reference, collecting everything attached to each zone from a set of folded
// gate states:
//
//   - works     — the cases/gates anchored here (each with its status & money)
//   - documents — the evidence/artifacts attached across those works
//
// It is pure: give it folded GateStates, get a per-zone view back.

import type { GateState, Outcome, Status } from "./types.ts";

export interface ZoneWork {
  gateId: string;
  status: Status;
  outcome?: Outcome;
  /** A short, human label for the work, if the claim carries one. */
  title?: string;
  role?: string;
  by?: string;
  at?: string;
  /** Net certified money released by this work, summed across its money effects. */
  amount?: number;
  currency?: string;
}

export interface ZoneDocument {
  kind: string;
  ref?: string;
  /** The work this document was attached to. */
  gateId: string;
}

export interface ZoneAttachments {
  zone: string;
  works: ZoneWork[];
  documents: ZoneDocument[];
  /** Aggregate acceptance across the zone's works. */
  rollup: { total: number; accepted: number; pct: number };
}

const ACCEPTED: Status[] = ["accepted", "accepted_with_exceptions"];

/** The zone a state is anchored to, read from a claim field (default "zone"). */
export function zoneOf(state: GateState, field = "zone"): string | undefined {
  const v = state.claim?.values?.[field];
  return typeof v === "string" ? v : undefined;
}

// Money lives inside each fired effect's payload (consequences.ts spreads the
// MoneyBreakdown there). Use the NET certified amount — what actually gets paid
// after retention — falling back to gross when a consequence carries no net.
function moneyOf(state: GateState): { amount?: number; currency?: string } {
  let amount: number | undefined;
  let currency: string | undefined;
  for (const c of state.consequences) {
    if (c.effect !== "money") continue;
    const p = c.payload;
    const net = typeof p.net === "number" ? p.net : typeof p.gross === "number" ? p.gross : undefined;
    if (net !== undefined) amount = (amount ?? 0) + net;
    if (typeof p.currency === "string") currency = p.currency;
  }
  return { amount, currency };
}

/**
 * Pick a short title for a work from common claim fields, so a zone's works
 * read as "structure" rather than just a gate id.
 */
function titleOf(state: GateState): string | undefined {
  const v = state.claim?.values ?? {};
  const pick = v.system ?? v.work_item ?? v.scope ?? v.subject ?? v.title;
  return typeof pick === "string" ? pick : undefined;
}

function workOf(state: GateState): ZoneWork {
  const { amount, currency } = moneyOf(state);
  return {
    gateId: state.gateId,
    status: state.status,
    outcome: state.decision?.outcome,
    title: titleOf(state),
    role: state.decision?.role,
    by: state.decision?.by,
    at: state.decision?.at,
    amount,
    currency,
  };
}

/** Group folded states by the zone their claim is anchored to. */
export function indexByZone(
  states: GateState[],
  field = "zone",
): Map<string, ZoneAttachments> {
  const map = new Map<string, ZoneAttachments>();
  for (const state of states) {
    const zone = zoneOf(state, field);
    if (!zone) continue;
    let entry = map.get(zone);
    if (!entry) {
      entry = { zone, works: [], documents: [], rollup: { total: 0, accepted: 0, pct: 0 } };
      map.set(zone, entry);
    }
    entry.works.push(workOf(state));
    for (const e of state.evidence) {
      entry.documents.push({ kind: e.kind, ref: e.ref, gateId: state.gateId });
    }
  }
  for (const entry of map.values()) {
    const total = entry.works.length;
    const accepted = entry.works.filter((w) => ACCEPTED.includes(w.status)).length;
    entry.rollup = { total, accepted, pct: total ? accepted / total : 0 };
  }
  return map;
}

/** Plain-object form (zone id → attachments), handy for JSON output / viewers. */
export function attachmentsByZone(
  states: GateState[],
  field = "zone",
): Record<string, ZoneAttachments> {
  return Object.fromEntries(indexByZone(states, field));
}

// ---------------------------------------------------------------------------
// Cross-case validation — things a single per-case check cannot see
// ---------------------------------------------------------------------------

/** A spatial model is anything exposing a list of zones with string ids. */
export interface SpatialModel {
  zones: { id: string }[];
}

export interface ZoneIssue {
  zone: string;
  kind: "unknown_zone" | "duplicate_acceptance";
  detail: string;
}

/** The set of valid zone ids declared by a spatial model. */
export function knownZoneIds(model: SpatialModel): Set<string> {
  return new Set(model.zones.map((z) => z.id));
}

/**
 * Validate a set of cases against the spatial world they reference. Catches
 * what an in-case check rule cannot, because it spans cases and the model:
 *   - unknown_zone: a claim is anchored to a zone the model doesn't contain
 *   - duplicate_acceptance: the same work (zone + system) was accepted twice
 */
export function lintZones(
  states: GateState[],
  model?: SpatialModel,
  field = "zone",
): ZoneIssue[] {
  const issues: ZoneIssue[] = [];
  const known = model ? knownZoneIds(model) : undefined;
  const acceptedSystems = new Map<string, number>(); // `${zone}|${system}` → count

  for (const state of states) {
    const zone = zoneOf(state, field);
    if (!zone) continue;

    if (known && !known.has(zone)) {
      issues.push({ zone, kind: "unknown_zone", detail: `zone "${zone}" is not in the model` });
    }

    const accepted = state.status === "accepted" || state.status === "accepted_with_exceptions";
    if (accepted) {
      const system = state.claim?.values?.system;
      const key = `${zone}|${typeof system === "string" ? system : state.gateId}`;
      acceptedSystems.set(key, (acceptedSystems.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of acceptedSystems) {
    if (count > 1) {
      const [zone, system] = key.split("|");
      issues.push({
        zone,
        kind: "duplicate_acceptance",
        detail: `"${system}" accepted ${count}× on zone ${zone}`,
      });
    }
  }
  return issues;
}
