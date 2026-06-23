import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim, Resource, delay, seize, release, rng } from "../src/index.ts";

test("delays advance the clock in order", () => {
  const sim = new Sim();
  const log: number[] = [];
  function* p(dt: number) {
    yield delay(dt);
    log.push(sim.now);
  }
  sim.process(p(30));
  sim.process(p(10));
  sim.process(p(20));
  sim.run();
  assert.deepEqual(log, [10, 20, 30]);
});

test("a capacity-1 resource serializes; finishes stagger by service time", () => {
  const sim = new Sim();
  const crane = new Resource("crane", 1);
  const done: number[] = [];
  function* job() {
    yield seize(crane);
    yield delay(10);
    yield release(crane);
    done.push(sim.now);
  }
  for (let i = 0; i < 3; i++) sim.process(job());
  sim.run();
  // All three arrive at t=0 but the single crane forces 10/20/30.
  assert.deepEqual(done, [10, 20, 30]);
  assert.equal(crane.peak, 1);
});

test("capacity-2 resource runs two in parallel", () => {
  const sim = new Sim();
  const crew = new Resource("crew", 2);
  const done: number[] = [];
  function* job() {
    yield seize(crew);
    yield delay(10);
    yield release(crew);
    done.push(sim.now);
  }
  for (let i = 0; i < 4; i++) sim.process(job());
  sim.run();
  assert.deepEqual(done, [10, 10, 20, 20]);
  assert.equal(crew.peak, 2);
});

test("contention queue is FIFO and deterministic under a seeded Rng", () => {
  const run = () => {
    const sim = new Sim();
    const r = rng("sched").stream("durations");
    const machine = new Resource("m", 1);
    const finish: Array<{ id: number; at: number }> = [];
    function* job(id: number) {
      yield seize(machine);
      yield delay(Math.round(r.lognormal(10, 0.3)));
      yield release(machine);
      finish.push({ id, at: sim.now });
    }
    for (let i = 0; i < 5; i++) sim.process(job(i));
    sim.run();
    return finish;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b); // replayable
  // FIFO: jobs complete in arrival order on a single machine.
  assert.deepEqual(a.map((x) => x.id), [0, 1, 2, 3, 4]);
  assert.ok(a.every((x, i) => i === 0 || x.at >= a[i - 1].at));
});

test("run(until) stops at the time bound, leaving later events pending", () => {
  const sim = new Sim();
  const seen: number[] = [];
  function* p(dt: number) {
    yield delay(dt);
    seen.push(dt);
  }
  sim.process(p(5));
  sim.process(p(50));
  sim.run(10);
  assert.deepEqual(seen, [5]);
  assert.equal(sim.now, 5);
});
