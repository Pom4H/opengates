// Open Gates — reference engine core types.
//
// These types mirror the JSON Schemas in ../../spec/schema and are written in
// "erasable" TypeScript (no enums, namespaces or runtime-bearing syntax) so the
// engine runs directly on Node's built-in type stripping (Node >= 22.18).

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

export type ISODate = string;
export type Domain = string;
export type Scalar = number | string | boolean;

/** The outcomes a reviewer may record when accepting responsibility for a claim. */
export type DecisionOutcome =
  | "accepted"
  | "accepted_with_exceptions"
  | "rejected"
  | "returned_for_rework";

/** Lifecycle status of a gate case as folded from its event log. */
export type GateStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "accepted"
  | "accepted_with_exceptions"
  | "rejected"
  | "returned_for_rework";

export type CheckOutcome = "pass" | "fail" | "warn" | "skipped";
export type Severity = "blocking" | "warning";

// ---------------------------------------------------------------------------
// Gate definition — the reusable acceptance pattern
// ---------------------------------------------------------------------------

export interface GateDefinition {
  /** Stable identifier, e.g. "construction.work-volume-acceptance". */
  id: string;
  name: string;
  domain: Domain;
  description?: string;
  /** What is being asserted. */
  claim: ClaimSchema;
  /** Evidence that may/must back the claim. */
  evidence: EvidenceRequirement[];
  /** Deterministic verification rules the engine evaluates. */
  checks: CheckDefinition[];
  /** The role that accepts responsibility for the decision. */
  reviewer: ReviewerSpec;
  /** Decision outcomes this gate allows. */
  decisions: DecisionOutcome[];
  /** What each decision releases: money, right to proceed, risk, dataset labels. */
  consequences: ConsequenceRule[];
  /** Optional policy describing when a decision may be automated. */
  policy?: AutomationPolicy;
}

export interface ClaimSchema {
  /** Claim type, e.g. "work_volume_completed". */
  type: string;
  fields: FieldDef[];
}

export interface FieldDef {
  name: string;
  kind: "number" | "string" | "boolean" | "date";
  unit?: string;
  required?: boolean;
}

export interface EvidenceRequirement {
  kind: string;
  required: boolean;
  description?: string;
}

export interface ReviewerSpec {
  role: string;
  description?: string;
}

// ---- Checks ---------------------------------------------------------------

export interface CheckBase {
  id: string;
  description?: string;
  /** Defaults to "blocking" when omitted. */
  severity?: Severity;
}

export interface RequiredEvidenceCheck extends CheckBase {
  rule: "required_evidence";
  kinds: string[];
}

export interface FieldPresentCheck extends CheckBase {
  rule: "field_present";
  field: string;
}

export interface FieldRangeCheck extends CheckBase {
  rule: "field_range";
  field: string;
  min?: number;
  max?: number;
}

/** Compares a claim field against a field on a specific kind of evidence. */
export interface CrossCheck extends CheckBase {
  rule: "cross_check";
  claimField: string;
  evidenceKind: string;
  evidenceField: string;
  /** Relative tolerance, e.g. 0.05 = 5%. */
  tolerance: number;
}

export type CheckDefinition =
  | RequiredEvidenceCheck
  | FieldPresentCheck
  | FieldRangeCheck
  | CrossCheck;

// ---- Consequences ---------------------------------------------------------

export interface ConsequenceBase {
  id: string;
  /** Decision outcomes that trigger this consequence. */
  on: DecisionOutcome[];
  description?: string;
}

export interface MoneyConsequence extends ConsequenceBase {
  effect: "money";
  currency: string;
  /** amount = claim[quantityField] * unitPrice ... */
  quantityField?: string;
  unitPrice?: number;
  /** ... or a fixed amount. */
  amount?: number;
}

export interface RightToProceedConsequence extends ConsequenceBase {
  effect: "right_to_proceed";
  /** Identifier of the step/work-package this unlocks. */
  unlocks: string;
}

export interface RiskConsequence extends ConsequenceBase {
  effect: "risk";
  /** Role/party that now carries the liability. */
  assignedTo: string;
}

export interface DatasetLabelConsequence extends ConsequenceBase {
  effect: "dataset_label";
  /** Logical dataset the labelled record is appended to. */
  dataset: string;
}

export type ConsequenceRule =
  | MoneyConsequence
  | RightToProceedConsequence
  | RiskConsequence
  | DatasetLabelConsequence;

export interface AutomationPolicy {
  /** When may this gate auto-accept without a human reviewer? */
  autoAcceptWhen?: {
    checksPass: true;
    /** Only auto-accept below this economic value; larger values stay human. */
    maxAmount?: number;
  };
}

// ---------------------------------------------------------------------------
// Runtime — instances and events
// ---------------------------------------------------------------------------

export interface ClaimInstance {
  type: string;
  values: Record<string, Scalar>;
}

export interface EvidenceInstance {
  kind: string;
  values?: Record<string, Scalar>;
  /** Pointer to the artifact (file, URL, hash, ...). */
  ref?: string;
}

export interface EventBase {
  at: ISODate;
  actor: string;
}

export interface ClaimSubmittedEvent extends EventBase {
  type: "claim.submitted";
  claim: ClaimInstance;
}

export interface EvidenceAttachedEvent extends EventBase {
  type: "evidence.attached";
  evidence: EvidenceInstance;
}

export interface DecisionRecordedEvent extends EventBase {
  type: "decision.recorded";
  reviewerRole: string;
  outcome: DecisionOutcome;
  note?: string;
}

export type GateEvent =
  | ClaimSubmittedEvent
  | EvidenceAttachedEvent
  | DecisionRecordedEvent;

// ---------------------------------------------------------------------------
// Folded state
// ---------------------------------------------------------------------------

export interface CheckResult {
  id: string;
  rule: string;
  outcome: CheckOutcome;
  detail?: string;
}

export interface ConsequenceEffect {
  id: string;
  effect: string;
  description?: string;
  amount?: number;
  currency?: string;
  unlocks?: string;
  assignedTo?: string;
  dataset?: string;
  label?: Record<string, unknown>;
}

export interface DatasetLabel {
  dataset: string;
  gate: string;
  claim_type?: string;
  features: Record<string, unknown>;
  label: DecisionOutcome;
  decided_by_role: string;
  at: ISODate;
}

export interface GateState {
  gateId: string;
  status: GateStatus;
  claim?: ClaimInstance;
  evidence: EvidenceInstance[];
  checks: CheckResult[];
  checksPassed: boolean;
  decision?: {
    outcome: DecisionOutcome;
    by: string;
    role: string;
    at: ISODate;
    note?: string;
  };
  /** Set when a positive decision transfers responsibility to the reviewer. */
  responsibility?: { acceptedBy: string; role: string; at: ISODate };
  consequences: ConsequenceEffect[];
  datasetLabel?: DatasetLabel;
  log: string[];
}

/** A scenario file: a gate reference plus an ordered event log. */
export interface Scenario {
  gate: string;
  events: GateEvent[];
}
