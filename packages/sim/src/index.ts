// Open Gates simulation toolkit (non-normative, OUTSIDE the acceptance engine).
//
// The engine decides whether a claim is accepted; this toolkit decides what
// happens in the world that produces those claims. It is deliberately a separate
// package: the simulator may be as rich and stochastic as reality demands while
// `packages/engine` stays pure and unchanged. See
// docs/architecture/realistic-simulation.md.

export { Rng, rng } from "./random.ts";
export { Sim, Resource, delay, seize, release } from "./process.ts";
export type { Cmd, Proc } from "./process.ts";
