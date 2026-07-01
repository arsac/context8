import { describe, expect, it } from "vitest";
import { hashKey, KeyManager } from "./keyManager.js";

const NONE = { limit: null, remaining: null, resetAt: null, retryAfterMs: null };

describe("KeyManager", () => {
  it("prefers the key with more estimated remaining", () => {
    const t = 0;
    const km = new KeyManager(["k1", "k2"], { assumedLimit: 100, now: () => t });
    // Spend k1 down via local accounting.
    for (let i = 0; i < 5; i++) km.markUsed("k1");
    expect(km.selectKey()).toBe("k2");
  });

  it("excludes a key in cooldown after a 429 and returns the other", () => {
    const t = 1000;
    const km = new KeyManager(["k1", "k2"], { assumedLimit: 100, now: () => t });
    km.recordResult("k1", 429, { ...NONE, retryAfterMs: 5000 });
    expect(km.selectKey()).toBe("k2");
  });

  it("returns null when all keys are cooling down", () => {
    const t = 1000;
    const km = new KeyManager(["k1"], { assumedLimit: 100, now: () => t });
    km.recordResult("k1", 429, { ...NONE, retryAfterMs: 5000 });
    expect(km.selectKey()).toBeNull();
    expect(km.nextResetAt()).toBe(6000);
  });

  it("frees a key once its cooldown elapses", () => {
    let t = 1000;
    const km = new KeyManager(["k1"], { assumedLimit: 100, now: () => t });
    km.recordResult("k1", 429, { ...NONE, retryAfterMs: 5000 });
    t = 6001;
    expect(km.selectKey()).toBe("k1");
  });

  it("reconciles used from RateLimit headers (self-correction)", () => {
    const t = 1000;
    const km = new KeyManager(["k1", "k2"], { assumedLimit: 100, now: () => t });
    // Header says k1 has only 3 remaining of 50 -> used = 47.
    km.recordResult("k1", 200, { limit: 50, remaining: 3, resetAt: 9999, retryAfterMs: null });
    // k2 untouched (100 remaining) should win.
    expect(km.selectKey()).toBe("k2");
  });

  it("rolls the window: resets used after windowResetAt passes", () => {
    let t = 1000;
    const km = new KeyManager(["k1", "k2"], { assumedLimit: 100, now: () => t });
    km.recordResult("k1", 200, { limit: 50, remaining: 1, resetAt: 2000, retryAfterMs: null });
    for (let i = 0; i < 90; i++) km.markUsed("k2"); // k2 heavily used
    t = 2001; // k1 window resets -> full again
    expect(km.selectKey()).toBe("k1");
  });

  it("hashes keys deterministically and never exposes raw keys in snapshot", () => {
    const km = new KeyManager(["secret-key"], { assumedLimit: 100, now: () => 0 });
    const snap = km.snapshot();
    expect(snap[0].keyHash).toBe(hashKey("secret-key"));
    expect(JSON.stringify(snap)).not.toContain("secret-key");
  });

  it("restores state by hash", () => {
    const km = new KeyManager(["k1"], { assumedLimit: 100, now: () => 0 });
    km.restore([
      {
        keyHash: hashKey("k1"),
        limit: 50,
        used: 49,
        remaining: 1,
        windowResetAt: 99999,
        cooldownUntil: 0,
        lastUsedAt: 0,
      },
    ]);
    const km2 = new KeyManager(["k1", "k2"], { assumedLimit: 100, now: () => 0 });
    km2.restore(km.snapshot());
    expect(km2.selectKey()).toBe("k2"); // k1 nearly exhausted
  });

  it("rolls the window inside recordResult before header-less accounting", () => {
    let t = 0;
    const km = new KeyManager(["k1"], { assumedLimit: 100, now: () => t });
    // Establish a window: limit 10, fully used, resets at t=1000.
    km.recordResult("k1", 200, { limit: 10, remaining: 0, resetAt: 1000, retryAfterMs: null });
    // After the window boundary, a header-less 200 must count against a fresh window.
    t = 1500;
    km.recordResult("k1", 200, NONE);
    const s = km.snapshot()[0];
    expect(s.used).toBe(1); // fresh window: exactly this one request, not 11
    expect(s.windowResetAt).toBe(0); // window rolled; no new reset known
  });
});
