import { childLogger } from "./logger";
import { metrics } from "./metrics";

/**
 * Circuit breaker for outbound dependencies (Ollama, FRED/Census, the dispatcher API,
 * webhook receivers).
 *
 *   closed     calls go through; consecutive failures are counted
 *   open       after `failureThreshold` failures, calls fail fast for `resetAfterMs`
 *   half-open  after the cool-down, up to `halfOpenMax` trial calls; one success closes
 *              the breaker, one failure opens it again
 *
 * Each call also gets a timeout, so a hanging dependency counts as a failure instead of
 * tying up a request. Callers keep their fallbacks (built-in answers, cached data) and
 * simply reach them faster when a breaker is open.
 */
export type BreakerState = "closed" | "open" | "half_open";

export class BreakerOpenError extends Error {
  constructor(public breaker: string) {
    super(`${breaker} is temporarily unavailable (circuit open)`);
  }
}

export interface BreakerOptions {
  failureThreshold?: number;
  resetAfterMs?: number;
  halfOpenMax?: number;
  timeoutMs?: number;
}

const log = childLogger("circuit-breaker");
const STATE_VALUE: Record<BreakerState, number> = { closed: 0, half_open: 1, open: 2 };

export class CircuitBreaker {
  state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;
  private trials = 0;
  readonly opts: Required<BreakerOptions>;

  constructor(
    readonly name: string,
    opts: BreakerOptions = {},
    private now: () => number = Date.now,
  ) {
    this.opts = { failureThreshold: 5, resetAfterMs: 30_000, halfOpenMax: 1, timeoutMs: 10_000, ...opts };
    metrics.breakerState.set({ breaker: name }, 0);
  }

  private transition(next: BreakerState) {
    if (this.state === next) return;
    log.warn({ breaker: this.name, from: this.state, to: next }, "circuit breaker state change");
    this.state = next;
    metrics.breakerState.set({ breaker: this.name }, STATE_VALUE[next]);
  }

  /** Run `fn` through the breaker. `fn` receives an AbortSignal that fires on timeout. */
  async exec<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (this.now() - this.openedAt >= this.opts.resetAfterMs) {
        this.transition("half_open");
        this.trials = 0;
      } else {
        metrics.breakerRejections.inc({ breaker: this.name });
        throw new BreakerOpenError(this.name);
      }
    }
    if (this.state === "half_open") {
      if (this.trials >= this.opts.halfOpenMax) {
        metrics.breakerRejections.inc({ breaker: this.name });
        throw new BreakerOpenError(this.name);
      }
      this.trials++;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`${this.name} timed out after ${this.opts.timeoutMs} ms`)), this.opts.timeoutMs);
    const started = performance.now();
    try {
      const result = await Promise.race([
        fn(controller.signal),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })),
      ]);
      this.onSuccess();
      metrics.externalCallDuration.observe({ target: this.name, outcome: "success" }, (performance.now() - started) / 1000);
      return result;
    } catch (error) {
      this.onFailure();
      metrics.externalCallDuration.observe({ target: this.name, outcome: "failure" }, (performance.now() - started) / 1000);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.transition("closed");
  }

  private onFailure() {
    this.failures++;
    if (this.state === "half_open" || this.failures >= this.opts.failureThreshold) {
      this.openedAt = this.now();
      this.transition("open");
    }
  }

  snapshot() {
    return { name: this.name, state: this.state, failures: this.failures };
  }
}

const globalForBreakers = globalThis as unknown as { suretteBreakers?: Map<string, CircuitBreaker> };
const registry = (globalForBreakers.suretteBreakers ??= new Map());

/** One shared breaker per dependency name. */
export function breaker(name: string, opts?: BreakerOptions): CircuitBreaker {
  let b = registry.get(name);
  if (!b) registry.set(name, (b = new CircuitBreaker(name, opts)));
  return b;
}

export function allBreakers() {
  return [...registry.values()].map((b) => b.snapshot());
}
