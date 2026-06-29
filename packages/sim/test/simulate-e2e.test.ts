import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProject, runSchedule, ensembleStats } from "../../../examples/construction/e2e/simulate.ts";

test("the full project is replayable — same seed ⇒ identical schedule", () => {
  const a = runSchedule(1, true);
  const b = runSchedule(1, true);
  assert.equal(a.finishDay, b.finishDay);
  assert.equal(a.disputes, b.disputes);
  assert.deepEqual([...a.sched.entries()], [...b.sched.entries()]);
});

test("variance off reproduces a clean plan that finishes earlier than the lived world", () => {
  const plan = runSchedule(1, false);
  const actual = runSchedule(1, true);
  assert.equal(plan.disputes, 0); // no rework in the variance-free baseline
  assert.ok(actual.finishDay > plan.finishDay); // reality slips past the plan
});

test("the whole simulated project folds through the unchanged engine to accepted facts", () => {
  const { cases } = buildProject(1);
  assert.ok(cases.length > 1500); // ~1560 acceptance acts
  assert.ok(cases.every((c) => ["accepted", "accepted_with_exceptions"].includes(c.state.status)));
  // Some went through a real dispute → rework → accept loop.
  assert.ok(cases.some((c) => c.state.log.some((l) => l.includes("returned_for_rework"))));
});

test("money is paid on the accepted reality — total is seed-independent", () => {
  const net = (seed: number) => {
    const { cases } = buildProject(seed);
    let s = 0;
    for (const c of cases) {
      if (!["accepted", "accepted_with_exceptions"].includes(c.state.status)) continue;
      for (const e of c.state.consequences) if (e.effect === "money") s += (e.payload as any).net ?? 0;
    }
    return Math.round(s * 100) / 100;
  };
  assert.equal(net(1), net(7)); // different worlds, same surveyed quantities accepted
});

test("ensemble gives an ordered schedule distribution with the plan below P50", () => {
  const e = ensembleStats([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(e.finishDayP90 >= e.finishDayP50 && e.finishDayP50 >= e.finishDayP10);
  assert.ok(e.plannedFinishDay < e.finishDayP50); // the plan is optimistic vs. reality
});
