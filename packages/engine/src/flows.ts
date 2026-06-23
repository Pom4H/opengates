// Resource flows — anchors and gate-backed edges.
//
// zones.ts inverts the claim->zone link to show what is anchored to a *place*.
// This module generalizes that idea to the whole operation: resources
// (materials, labour, equipment) move between anchors, and every move is itself
// an Acceptance Act. Where indexByZone answers "what is built here", flowGraph
// and resourceLedger answer "out of what, and where did it go".
//
// The one rule that keeps the picture trustworthy (see
// docs/architecture/resource-flow-and-domains.md): every edge is gate-backed.
// A flow's status and money are *derived* from its folded GateState — never set
// by hand. It is pure: give it folded GateStates (+ an optional model), get a
// node/edge graph, a per-resource ledger, and cross-case issues back.

import type { GateState, Scalar, Status } from "./types.ts";

// ---------------------------------------------------------------------------
// Ontology (L1) — the generalization of zone + indexByZone
// ---------------------------------------------------------------------------

/** What a fact can be anchored to. A zone is the spatial special-case. */
export type AnchorKind = "zone" | "resource" | "actor" | "account" | "capital_work";

/** Materials are consumed (mass balance); equipment is leased (capacity). */
export type ResourceKind = "material" | "labor" | "equipment";

export interface Anchor {
  id: string;
  kind: AnchorKind;
  label?: string;
  domain?: string;
  /** For kind "resource": what discipline its ledger follows. */
  resourceKind?: ResourceKind;
  unit?: string;
}

/** The verbs an edge can carry. Each is one gate case. */
export type FlowKind = "deliver" | "rent" | "return" | "consume" | "produce" | "pay";

export interface Flow {
  id: string;
  kind: FlowKind;
  from: string;
  to: string;
  /** The resource anchor this flow moves (absent for produce/pay). */
  resource?: string;
  /** The claimed quantity. */
  qty?: number;
  /** The quantity the reviewer actually accepted, when it differs from the claim. */
  acceptedQty?: number;
  unit?: string;
  /** Derived from the backing case — never hand-set. */
  status: Status;
  amount?: number;
  currency?: string;
  /** The gate definition that decided this flow, for click-through. */
  gateId: string;
  title?: string;
}

/** An operational model declares the anchors (like building.json declares zones). */
export interface OperationalModel {
  anchors: Anchor[];
}

export interface FlowGraph {
  nodes: Anchor[];
  edges: Flow[];
}

export interface ResourceLine {
  resource: string;
  unit?: string;
  resourceKind?: ResourceKind;
  /** Accepted inflow (deliver + rent). */
  in: number;
  /** Outflow drawn down (consume). */
  out: number;
  /** in − out. Negative means more was consumed than was ever accepted in. */
  remaining: number;
  flows: number;
}

export type FlowIssueKind = "unknown_anchor" | "negative_stock";

export interface FlowIssue {
  kind: FlowIssueKind;
  detail: string;
  resource?: string;
  anchor?: string;
}

const ACCEPTED: Status[] = ["accepted", "accepted_with_exceptions"];
const FLOW_KINDS = new Set<FlowKind>(["deliver", "rent", "return", "consume", "produce", "pay"]);
/** Kinds that add to a resource's stock when accepted. */
const INFLOW = new Set<FlowKind>(["deliver", "rent", "return"]);

function num(v: Scalar | undefined): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function str(v: Scalar | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// Net certified money, mirroring zones.ts: NET after retention, falling back to
// gross. Money lives in each fired effect's payload (consequences.ts).
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
 * The flow a state describes, or undefined if it isn't a flow. Two shapes:
 *   - explicit: the claim carries `from` + `to` (+ `resource`, `qty`, a
 *     `flowKind`); a delivery, rental, crew ride, consumption or payment.
 *   - produce:  a zone+system acceptance (the construction systems gate) is read
 *     as a `produce` edge SYS-{zone}-{system} -> {zone}, so today's data joins in
 *     with no new fields.
 */
export function flowOf(state: GateState): Flow | undefined {
  const v = state.claim?.values ?? {};
  const accepted = state.decision?.acceptedValues ?? {};
  const from = str(v.from);
  const to = str(v.to);
  const { amount, currency } = moneyOf(state);
  const acceptedQty = num(accepted.qty) ?? num(accepted.quantity);

  if (from && to) {
    const declared = str(v.flowKind) as FlowKind | undefined;
    const kind: FlowKind = declared && FLOW_KINDS.has(declared) ? declared : "deliver";
    const resource = str(v.resource);
    const qty = num(v.qty) ?? num(v.quantity);
    return {
      id: `${kind}:${from}->${to}${resource ? `:${resource}` : ""}`,
      kind,
      from,
      to,
      resource,
      qty,
      acceptedQty,
      unit: str(v.unit),
      status: state.status,
      amount,
      currency,
      gateId: state.gateId,
      title: str(v.work_item) ?? str(v.system) ?? resource,
    };
  }

  const zone = str(v.zone);
  const system = str(v.system);
  if (zone && system) {
    const work = `SYS-${zone}-${system}`;
    return {
      id: `produce:${work}->${zone}`,
      kind: "produce",
      from: work,
      to: zone,
      qty: num(v.quantity),
      acceptedQty,
      unit: str(v.unit),
      status: state.status,
      amount,
      currency,
      gateId: state.gateId,
      title: system,
    };
  }

  return undefined;
}

/** Every flow across a set of folded states (skips states that aren't flows). */
export function flowsOf(states: GateState[]): Flow[] {
  const out: Flow[] = [];
  for (const s of states) {
    const f = flowOf(s);
    if (f) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Projections (L3) — read models the views consume
// ---------------------------------------------------------------------------

/**
 * Nodes + gate-backed edges for the flow view. Nodes come from the model's
 * declared anchors, plus any anchor an edge references that the model omits (so
 * the graph is never dangling). The synthesized produce source (SYS-…) is added
 * as a capital_work node when missing.
 */
export function flowGraph(states: GateState[], model?: OperationalModel): FlowGraph {
  const edges = flowsOf(states);
  const nodes = new Map<string, Anchor>();
  for (const a of model?.anchors ?? []) nodes.set(a.id, a);
  for (const e of edges) {
    for (const id of [e.from, e.to]) {
      if (nodes.has(id)) continue;
      const kind: AnchorKind = id.startsWith("SYS-")
        ? "capital_work"
        : e.resource === id
          ? "resource"
          : "actor";
      nodes.set(id, { id, kind, label: id });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/**
 * Per-resource ledger: accepted inflow vs. drawn-down outflow, and what is left.
 * This is the mass-balance — the cross_check principle applied to stock rather
 * than to a survey. Only *accepted* inflow counts as available; consumption is
 * physical and counts regardless of decision state.
 */
export function resourceLedger(
  states: GateState[],
  model?: OperationalModel,
): Map<string, ResourceLine> {
  const meta = new Map<string, Anchor>();
  for (const a of model?.anchors ?? []) if (a.kind === "resource") meta.set(a.id, a);

  const lines = new Map<string, ResourceLine>();
  const ensure = (id: string): ResourceLine => {
    let l = lines.get(id);
    if (!l) {
      const m = meta.get(id);
      l = { resource: id, unit: m?.unit, resourceKind: m?.resourceKind, in: 0, out: 0, remaining: 0, flows: 0 };
      lines.set(id, l);
    }
    return l;
  };

  for (const f of flowsOf(states)) {
    if (!f.resource || f.qty === undefined) continue;
    const l = ensure(f.resource);
    l.flows += 1;
    if (l.unit === undefined) l.unit = f.unit;
    if (INFLOW.has(f.kind)) {
      // Only accepted inflow is available, and only the *accepted* quantity —
      // pay/stock on reality, not the claim (the engine's whole point).
      if (ACCEPTED.includes(f.status)) l.in += f.acceptedQty ?? f.qty;
    } else if (f.kind === "consume") {
      l.out += f.qty;
    }
  }
  for (const l of lines.values()) l.remaining = l.in - l.out;
  return lines;
}

/** Plain-object form, handy for JSON output / viewers (e.g. viz/model/flows.json). */
export function flowGraphJSON(states: GateState[], model?: OperationalModel): FlowGraph {
  return flowGraph(states, model);
}

export function ledgerJSON(
  states: GateState[],
  model?: OperationalModel,
): Record<string, ResourceLine> {
  return Object.fromEntries(resourceLedger(states, model));
}

// ---------------------------------------------------------------------------
// Cross-case validation — what a single per-case check cannot see
// ---------------------------------------------------------------------------

/**
 * Validate flows against the operational world. Catches what an in-case rule
 * can't, because it spans cases and the model:
 *   - unknown_anchor:  a flow references an anchor the model doesn't declare
 *   - negative_stock:  a resource was consumed beyond what was ever accepted in
 *                      (the mass balance went negative)
 */
export function lintFlows(states: GateState[], model?: OperationalModel): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const known = model ? new Set(model.anchors.map((a) => a.id)) : undefined;

  if (known) {
    for (const f of flowsOf(states)) {
      for (const id of [f.from, f.to]) {
        // Synthesized capital_work sources aren't expected in the model.
        if (id.startsWith("SYS-")) continue;
        if (!known.has(id)) {
          issues.push({ kind: "unknown_anchor", anchor: id, detail: `anchor "${id}" is not in the model` });
        }
      }
    }
  }

  for (const l of resourceLedger(states, model).values()) {
    if (l.remaining < 0) {
      issues.push({
        kind: "negative_stock",
        resource: l.resource,
        detail: `${l.resource}: consumed ${l.out} of ${l.in} accepted (${l.remaining} ${l.unit ?? ""})`.trimEnd(),
      });
    }
  }
  return issues;
}
