// A tiny discrete-event simulation kernel.
//
// The realism in "close-to-reality" comes from time and contention: tasks take
// variable durations, and they compete for FINITE resources (a crew, the one
// tower crane, a delivery slot). A schedule that EMERGES from those constraints
// is far closer to a real site than a fixed days-per-floor table.
//
// This kernel models exactly that, with nothing else: a simulated clock, an
// event queue ordered by (time, insertion) so ties break deterministically, and
// `Resource`s with finite capacity and FIFO queues. Processes are generators
// that `yield` three commands — delay, seize, release — and the kernel resumes
// them. It reads NO wall clock and NO Math.random; all time is simulated and all
// variability comes from an injected Rng. Same inputs ⇒ identical trace.

export type Cmd =
  | { kind: "delay"; dt: number }
  | { kind: "seize"; res: Resource }
  | { kind: "release"; res: Resource };

export type Proc = Generator<Cmd, void, void>;

/** Wait `dt` simulated time units. */
export const delay = (dt: number): Cmd => ({ kind: "delay", dt });
/** Acquire one unit of `res`, blocking (FIFO) until one is free. */
export const seize = (res: Resource): Cmd => ({ kind: "seize", res });
/** Give one unit of `res` back, waking the next waiter. */
export const release = (res: Resource): Cmd => ({ kind: "release", res });

export class Resource {
  readonly name: string;
  readonly capacity: number;
  busy = 0;
  /** Peak concurrent usage and total wait — cheap utilization telemetry. */
  peak = 0;
  private waiters: Array<() => void> = [];

  constructor(name: string, capacity = 1) {
    this.name = name;
    this.capacity = capacity;
  }

  get free(): number {
    return this.capacity - this.busy;
  }

  /** @internal */
  _acquire(grant: () => void): void {
    if (this.busy < this.capacity) {
      this.busy++;
      this.peak = Math.max(this.peak, this.busy);
      grant();
    } else {
      this.waiters.push(grant);
    }
  }

  /** @internal — returns the next waiter to grant (already counted busy), if any. */
  _release(): (() => void) | undefined {
    this.busy--;
    const next = this.waiters.shift();
    if (next) {
      this.busy++;
      this.peak = Math.max(this.peak, this.busy);
      return next;
    }
    return undefined;
  }
}

interface Scheduled {
  t: number;
  seq: number;
  fn: () => void;
}

export class Sim {
  now = 0;
  private seq = 0;
  private heap: Scheduled[] = [];

  /** Schedule `fn` to run `dt` units from now (dt ≥ 0). */
  schedule(dt: number, fn: () => void): void {
    this.heap.push({ t: this.now + Math.max(0, dt), seq: this.seq++, fn });
  }

  /** Start a process generator now. */
  process(gen: Proc): void {
    this.resume(gen);
  }

  private resume(gen: Proc): void {
    const step = gen.next();
    if (step.done) return;
    const cmd = step.value;
    if (cmd.kind === "delay") {
      this.schedule(cmd.dt, () => this.resume(gen));
    } else if (cmd.kind === "seize") {
      // Route the grant through the queue (dt 0) so ordering stays event-driven
      // and the call stack never grows with contention.
      cmd.res._acquire(() => this.schedule(0, () => this.resume(gen)));
    } else {
      const next = cmd.res._release();
      if (next) next();
      this.schedule(0, () => this.resume(gen));
    }
  }

  /** Pop the next event; advances `now`. Returns false when the queue is empty. */
  step(): boolean {
    if (this.heap.length === 0) return false;
    // Linear-scan min by (t, seq). Fine for the scales here; swap for a heap if needed.
    let mi = 0;
    for (let i = 1; i < this.heap.length; i++) {
      const a = this.heap[i];
      const b = this.heap[mi];
      if (a.t < b.t || (a.t === b.t && a.seq < b.seq)) mi = i;
    }
    const ev = this.heap.splice(mi, 1)[0];
    this.now = ev.t;
    ev.fn();
    return true;
  }

  /** Run until the queue drains or simulated time passes `until`. */
  run(until = Infinity): void {
    while (this.heap.length) {
      let mi = 0;
      for (let i = 1; i < this.heap.length; i++) {
        const a = this.heap[i];
        const b = this.heap[mi];
        if (a.t < b.t || (a.t === b.t && a.seq < b.seq)) mi = i;
      }
      if (this.heap[mi].t > until) break;
      this.step();
    }
  }
}
