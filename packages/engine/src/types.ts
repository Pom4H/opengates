// Core types for the Open Gates engine.
//
// These mirror the JSON Schemas in ../../spec/schema/. They are written as
// erasable TypeScript (no enum / namespace / decorators / parameter properties)
// so the engine runs under Node's built-in type stripping with no build step.

export type ISODate = string;
export type Scalar = string | number | boolean;

// ---------------------------------------------------------------------------
// Gate definition — the reusable acceptance pattern
// ---------------------------------------------------------------------------

export type FieldKind = "number" | "string" | "boolean" | "date" | "zone";

export interface ClaimField {
  name: string;
  kind: FieldKind;
  unit?: string;
  required?: boolean;
}

export interface ClaimSpec {
  type: string;
  fields: ClaimField[];
}

export interface EvidenceSpec {
  kind: string;
  required?: boolean;
  description?: string;
}

export type CheckSeverity = "blocking" | "warning";

export interface RequiredEvidenceCheck {
  id: string;
  rule: "required_evidence";
  kinds: string[];
  severity?: CheckSeverity;
  description?: string;
}

export interface FieldPresentCheck {
  id: string;
  rule: "field_present";
  field: string;
  severity?: CheckSeverity;
  description?: string;
}

export interface FieldRangeCheck {
  id: string;
  rule: "field_range";
  field: string;
  min?: number;
  max?: number;
  severity?: CheckSeverity;
  description?: string;
}

// A claim field must be a string matching `pattern` (anchored regex, e.g. a
// zone id "^[A-Z]\\d+-F\\d{2}$"). Format-only — it does not cross-reference a
// model; that lives in lintZones (spans cases + the spatial model).
export interface FieldPatternCheck {
  id: string;
  rule: "field_pattern";
  field: string;
  pattern: string;
  severity?: CheckSeverity;
  description?: string;
}

// Claim vs. reality. The evidence value is the trusted REFERENCE; relative error
// is normalized by it (VIM §2.16), not by the claim. `absolute` is a floor in the
// evidence unit; the acceptance limit is whichever of the two is greater. When the
// evidence carries an expanded uncertainty U (GUM, U = k·u), the claim must also
// fall inside that band.
export interface CrossCheck {
  id: string;
  rule: "cross_check";
  claimField: string;
  claimUnit?: string;
  evidenceKind: string;
  evidenceField: string;
  evidenceUnitField?: string;
  uncertaintyField?: string;
  requireUnitMatch?: boolean;
  tolerance?: number;
  absolute?: number;
  severity?: CheckSeverity;
  description?: string;
}

export interface DateWindowCheck {
  id: string;
  rule: "date_window";
  field: string;
  start?: ISODate;
  end?: ISODate;
  severity?: CheckSeverity;
  description?: string;
}

export type Check =
  | RequiredEvidenceCheck
  | FieldPresentCheck
  | FieldRangeCheck
  | FieldPatternCheck
  | CrossCheck
  | DateWindowCheck;

export type CheckRule = Check["rule"];
export type CheckOutcome = "pass" | "fail" | "skipped";

export interface CheckResult {
  id: string;
  rule: CheckRule;
  outcome: CheckOutcome;
  severity: CheckSeverity;
  detail?: string;
}

export interface ReviewerSpec {
  role: string;
  description?: string;
}

export type Outcome =
  | "accepted"
  | "accepted_with_exceptions"
  | "rejected"
  | "returned_for_rework";

export type MoneyBasis = "accepted_quantity" | "fixed";

export interface MoneyConsequence {
  id: string;
  effect: "money";
  on: Outcome[];
  basis?: MoneyBasis;
  // Unit-rate billing: pay `unitPrice` per accepted unit of `quantityField`.
  quantityField?: string;
  unitPrice?: number;
  // ...or a fixed amount.
  amount?: number;
  currency: string;
  retentionPct?: number;
  retentionCap?: number;
  vatRate?: number;
  paymentTermsDays?: number;
  estimateLine?: string;
  contractRef?: string;
  description?: string;
}

export interface RightToProceedConsequence {
  id: string;
  effect: "right_to_proceed";
  on: Outcome[];
  unlocks: string;
  description?: string;
}

export interface RiskConsequence {
  id: string;
  effect: "risk";
  on: Outcome[];
  assignedTo: string;
  description?: string;
}

export interface DatasetLabelConsequence {
  id: string;
  effect: "dataset_label";
  on: Outcome[];
  dataset: string;
  description?: string;
}

export type Consequence =
  | MoneyConsequence
  | RightToProceedConsequence
  | RiskConsequence
  | DatasetLabelConsequence;

export type EffectKind = Consequence["effect"];

export interface GateSla {
  reviewWithinHours: number;
  priority?: "low" | "normal" | "high" | "critical";
  escalateToInbox?: string;
}

export interface AutomationPolicy {
  autoAcceptWhen?: {
    checksPass: boolean;
    maxAmount?: number;
  };
}

export interface GateDefinition {
  id: string;
  name: string;
  domain: string;
  description?: string;
  claim: ClaimSpec;
  evidence: EvidenceSpec[];
  checks: Check[];
  reviewer: ReviewerSpec;
  decisions: Outcome[];
  consequences: Consequence[];
  sla?: GateSla;
  policy?: AutomationPolicy;
}

// ---------------------------------------------------------------------------
// Events — the append-only log a case is made of
// ---------------------------------------------------------------------------

export interface EventBase {
  // Stable, unique event id (uuid/ULID for live cases; derived for authored
  // scenarios). Used to dedup on replay so fold is idempotent under redelivery.
  id: string;
  // Monotonic per-case sequence. apply() requires seq === state.seq + 1.
  seq: number;
  at: ISODate;
  actor: string;
}

export interface ClaimValue {
  type: string;
  values: Record<string, Scalar>;
}

export interface EvidenceValue {
  kind: string;
  values?: Record<string, Scalar>;
  ref?: string;
}

export interface ClaimSubmittedEvent extends EventBase {
  type: "claim.submitted";
  claim: ClaimValue;
}

export interface EvidenceAttachedEvent extends EventBase {
  type: "evidence.attached";
  evidence: EvidenceValue;
}

export interface DecisionRecordedEvent extends EventBase {
  type: "decision.recorded";
  reviewerRole: string;
  outcome: Outcome;
  // The quantities the reviewer actually accepted (e.g. surveyed 117, not
  // claimed 120). Money is paid on these.
  acceptedValues?: Record<string, Scalar>;
  note?: string;
}

export type GateEvent =
  | ClaimSubmittedEvent
  | EvidenceAttachedEvent
  | DecisionRecordedEvent;

// An event as authored in a scenario file: id/seq are optional and synthesized
// deterministically by loadScenario()/normalizeLog().
export type AuthoredEvent = Omit<GateEvent, "id" | "seq"> & {
  id?: string;
  seq?: number;
};

export interface Scenario {
  gate: string;
  events: GateEvent[];
}

// ---------------------------------------------------------------------------
// Effects and folded state
// ---------------------------------------------------------------------------

export interface FiredEffect {
  // Stable dedup key for exactly-once delivery: sha256(decisionEventId:ruleId).
  effectId: string;
  ruleId: string;
  effect: EffectKind;
  payload: Record<string, unknown>;
}

export type Status = "draft" | "submitted" | "under_review" | Outcome;

export interface Decision {
  outcome: Outcome;
  by: string;
  role: string;
  at: ISODate;
  acceptedValues?: Record<string, Scalar>;
  note?: string;
}

export interface Responsibility {
  acceptedBy: string;
  role: string;
  at: ISODate;
}

export interface DatasetLabelRecord {
  dataset: string;
  gate: string;
  claim_type: string;
  features: Record<string, unknown>;
  label: Outcome;
  decided_by_role: string;
  at: ISODate;
}

export interface GateState {
  gateId: string;
  status: Status;
  seq: number;
  seenIds: string[];
  claim?: ClaimValue;
  evidence: EvidenceValue[];
  checks: CheckResult[];
  checksPassed: boolean;
  decision?: Decision;
  responsibility?: Responsibility;
  consequences: FiredEffect[];
  datasetLabel?: DatasetLabelRecord;
  // Derived from event timestamps (free; powers the FP&A / cycle-time view).
  submittedAt?: ISODate;
  decidedAt?: ISODate;
  cycleDays?: number;
  log: string[];
}
