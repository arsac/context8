import { describe, expect, it } from "vitest";
import { ResponseCache } from "./cache.js";

describe("ResponseCache", () => {
  it("returns a stored value before expiry", () => {
    let t = 1000;
    const c = new ResponseCache({ maxEntries: 10, ttlMs: 500, now: () => t });
    c.set("k", "v");
    t = 1400;
    expect(c.get("k")).toBe("v");
  });

  it("misses after TTL expiry and drops the entry", () => {
    let t = 1000;
    const c = new ResponseCache({ maxEntries: 10, ttlMs: 500, now: () => t });
    c.set("k", "v");
    t = 1600;
    expect(c.get("k")).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("evicts least-recently-used when over capacity", () => {
    const c = new ResponseCache({ maxEntries: 2, ttlMs: 10_000, now: () => 0 });
    c.set("a", "1");
    c.set("b", "2");
    expect(c.get("a")).toBe("1"); // touch a -> b is now LRU
    c.set("c", "3"); // evicts b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe("1");
    expect(c.get("c")).toBe("3");
  });

  it("is disabled when ttlMs is 0", () => {
    const c = new ResponseCache({ maxEntries: 10, ttlMs: 0, now: () => 0 });
    c.set("k", "v");
    expect(c.get("k")).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("snapshot and restore round-trip", () => {
    const c = new ResponseCache({ maxEntries: 10, ttlMs: 500, now: () => 1000 });
    c.set("k", "v");
    const snap = c.snapshot();
    const c2 = new ResponseCache({ maxEntries: 10, ttlMs: 500, now: () => 1000 });
    c2.restore(snap);
    expect(c2.get("k")).toBe("v");
  });
});
