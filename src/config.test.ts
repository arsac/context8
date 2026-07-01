import { describe, expect, it } from "vitest";
import { loadConfig, parseApiKeys } from "./config.js";

describe("parseApiKeys", () => {
  it("merges CSV, indexed, and singular, deduped in order", () => {
    const env = {
      CONTEXT7_API_KEYS: "a, b ,c",
      CONTEXT7_API_KEY_1: "d",
      CONTEXT7_API_KEY_2: "b",
      CONTEXT7_API_KEY: "e",
    } as NodeJS.ProcessEnv;
    expect(parseApiKeys(env)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("sorts indexed keys numerically", () => {
    const env = {
      CONTEXT7_API_KEY_10: "ten",
      CONTEXT7_API_KEY_2: "two",
    } as NodeJS.ProcessEnv;
    expect(parseApiKeys(env)).toEqual(["two", "ten"]);
  });
});

describe("loadConfig", () => {
  it("applies defaults and converts TTL seconds to ms", () => {
    const cfg = loadConfig({ CONTEXT7_API_KEYS: "k1" } as NodeJS.ProcessEnv);
    expect(cfg.apiKeys).toEqual(["k1"]);
    expect(cfg.baseUrl).toBe("https://context7.com");
    expect(cfg.cacheTtlMs).toBe(3600 * 1000);
    expect(cfg.cacheMax).toBe(500);
    expect(cfg.stateFile).toBeNull();
    expect(cfg.maxWaitMs).toBe(10000);
    expect(cfg.assumedLimit).toBe(100);
  });

  it("throws when no keys are configured", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/no .*api key/i);
  });

  it("honors CONTEXT7_CACHE_TTL=0 (disabled)", () => {
    const cfg = loadConfig({
      CONTEXT7_API_KEYS: "k1",
      CONTEXT7_CACHE_TTL: "0",
    } as NodeJS.ProcessEnv);
    expect(cfg.cacheTtlMs).toBe(0);
  });
});
