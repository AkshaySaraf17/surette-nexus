import { describe, expect, it } from "vitest";
import { BreakerOpenError, CircuitBreaker } from "@/lib/server/circuit-breaker";
import { backoffMs } from "@/lib/server/jobs";

const fail = () => Promise.reject(new Error("down"));
const ok = () => Promise.resolve("ok");

describe("circuit breaker", () => {
  it("opens after the failure threshold and fails fast while open", async () => {
    const now = 0;
    const b = new CircuitBreaker("test-open", { failureThreshold: 3, resetAfterMs: 1_000, timeoutMs: 500 }, () => now);
    for (let i = 0; i < 3; i++) await expect(b.exec(fail)).rejects.toThrow("down");
    expect(b.state).toBe("open");
    let called = false;
    await expect(b.exec(async () => ((called = true), "x"))).rejects.toBeInstanceOf(BreakerOpenError);
    expect(called).toBe(false);
  });

  it("half-opens after the cool-down: one success closes it, one failure re-opens it", async () => {
    let now = 0;
    const b = new CircuitBreaker("test-half", { failureThreshold: 1, resetAfterMs: 1_000, timeoutMs: 500 }, () => now);
    await expect(b.exec(fail)).rejects.toThrow();
    expect(b.state).toBe("open");
    now = 1_000;
    await expect(b.exec(fail)).rejects.toThrow("down");
    expect(b.state).toBe("open");
    now = 2_000;
    await expect(b.exec(ok)).resolves.toBe("ok");
    expect(b.state).toBe("closed");
  });

  it("a success resets the consecutive-failure count", async () => {
    const b = new CircuitBreaker("test-reset", { failureThreshold: 2, timeoutMs: 500 });
    await expect(b.exec(fail)).rejects.toThrow();
    await b.exec(ok);
    await expect(b.exec(fail)).rejects.toThrow();
    expect(b.state).toBe("closed");
  });

  it("times out hanging calls and counts them as failures", async () => {
    const b = new CircuitBreaker("test-timeout", { failureThreshold: 1, timeoutMs: 30 });
    await expect(b.exec(() => new Promise(() => undefined))).rejects.toThrow(/timed out/);
    expect(b.state).toBe("open");
  });
});

describe("job retry backoff", () => {
  it("grows exponentially, is capped at an hour, with ±20% jitter", () => {
    expect(backoffMs(1, () => 0.5)).toBe(5_000);
    expect(backoffMs(2, () => 0.5)).toBe(20_000);
    expect(backoffMs(3, () => 0.5)).toBe(80_000);
    expect(backoffMs(20, () => 0.5)).toBe(3_600_000);
    expect(backoffMs(1, () => 0)).toBe(4_000);
    expect(backoffMs(1, () => 1)).toBe(6_000);
  });
});
