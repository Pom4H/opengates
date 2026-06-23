// Dataset labels: the features -> label records that accumulate from decided
// cases. They are the training/eval substrate that lets some decisions become
// automatable (see eval/replay.mjs and SPEC §8).

import type { DatasetLabelRecord, GateState } from "./types.ts";

/** The labelled record a decided case produced, if any. */
export function labelOf(state: GateState): DatasetLabelRecord | undefined {
  return state.datasetLabel;
}

/** Collect labels from many folded states (e.g. an exported queue). */
export function collectLabels(states: GateState[]): DatasetLabelRecord[] {
  return states.map(labelOf).filter((r): r is DatasetLabelRecord => r !== undefined);
}

/** Serialize labelled records as JSON Lines for the og://dataset/{name} feed. */
export function toJsonl(records: DatasetLabelRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}
