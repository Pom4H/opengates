// Outbox: deliver fired effects exactly once.
//
// The fold records WHICH effects a decision fires (each with a stable effectId).
// Actually applying them to the outside world — paying money, calling a webhook —
// is impure and lives here, OUTSIDE the fold. Delivery is keyed by effectId, so
// replaying the same log (or retrying a crashed delivery) delivers each effect
// once. The set of delivered ids is the durable bit you persist.

import type { FiredEffect } from "./types.ts";

export interface Outbox {
  delivered: Set<string>;
}

export interface DeliveryResult {
  delivered: string[];
  skipped: string[];
}

export function createOutbox(deliveredIds: Iterable<string> = []): Outbox {
  return { delivered: new Set(deliveredIds) };
}

/** Effects not yet delivered (safe to send). */
export function pending(outbox: Outbox, effects: FiredEffect[]): FiredEffect[] {
  return effects.filter((e) => !outbox.delivered.has(e.effectId));
}

/**
 * Deliver each effect at most once. `send` is your impure handler (pay, POST,
 * enqueue downstream). Already-delivered effectIds are skipped, so this is safe
 * to call repeatedly on the same effects.
 */
export async function deliver(
  outbox: Outbox,
  effects: FiredEffect[],
  send: (effect: FiredEffect) => Promise<void>,
): Promise<DeliveryResult> {
  const delivered: string[] = [];
  const skipped: string[] = [];
  for (const e of effects) {
    if (outbox.delivered.has(e.effectId)) {
      skipped.push(e.effectId);
      continue;
    }
    await send(e);
    outbox.delivered.add(e.effectId);
    delivered.push(e.effectId);
  }
  return { delivered, skipped };
}
