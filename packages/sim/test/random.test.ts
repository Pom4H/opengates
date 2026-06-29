import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, rng } from "../src/index.ts";

test("same seed yields an identical sequence (replayable)", () => {
  const a = rng("project-A");
  const b = rng("project-A");
  const sa = Array.from({ length: 8 }, () => a.float());
  const sb = Array.from({ length: 8 }, () => b.float());
  assert.deepEqual(sa, sb);
});

test("different seeds diverge", () => {
  const a = Array.from({ length: 8 }, () => rng("seed-1").float());
  const b = Array.from({ length: 8 }, () => rng("seed-2").float());
  assert.notDeepEqual(a, b);
});

test("float stays in [0,1)", () => {
  const r = rng(42);
  for (let i = 0; i < 10000; i++) {
    const x = r.float();
    assert.ok(x >= 0 && x < 1);
  }
});

test("named streams are independent of draw order", () => {
  // Drawing from the parent before deriving a stream must not change the stream.
  const p1 = rng("root");
  const sA = p1.stream("durations");
  const first = Array.from({ length: 5 }, () => sA.float());

  const p2 = rng("root");
  for (let i = 0; i < 17; i++) p2.float(); // perturb the parent
  const sB = p2.stream("durations");
  const second = Array.from({ length: 5 }, () => sB.float());

  assert.deepEqual(first, second);
});

test("different stream names produce different sequences", () => {
  const root = rng("root");
  const a = Array.from({ length: 5 }, () => root.stream("weather").float());
  const b = Array.from({ length: 5 }, () => root.stream("supply").float());
  assert.notDeepEqual(a, b);
});

test("bool(p) converges near p", () => {
  const r = rng("coins");
  let heads = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) if (r.bool(0.3)) heads++;
  assert.ok(Math.abs(heads / n - 0.3) < 0.02, `got ${heads / n}`);
});

test("lognormal is positive and centered near its median", () => {
  const r = rng("durations");
  const xs = Array.from({ length: 20000 }, () => r.lognormal(10, 0.4));
  assert.ok(xs.every((x) => x > 0));
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  assert.ok(Math.abs(median - 10) < 0.5, `median ${median}`);
});

test("triangular stays within bounds", () => {
  const r = rng("tri");
  for (let i = 0; i < 10000; i++) {
    const x = r.triangular(2, 5, 9);
    assert.ok(x >= 2 && x <= 9);
  }
});

test("weighted choice respects the weights", () => {
  const r = rng("w");
  const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
  const n = 30000;
  for (let i = 0; i < n; i++) counts[r.weighted(["a", "b", "c"], [1, 3, 6])]++;
  assert.ok(counts.c > counts.b && counts.b > counts.a);
  assert.ok(Math.abs(counts.c / n - 0.6) < 0.02);
});

test("poisson mean is near lambda", () => {
  const r = rng("p");
  const n = 20000;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += r.poisson(2.5);
  assert.ok(Math.abs(sum / n - 2.5) < 0.1, `mean ${sum / n}`);
});
