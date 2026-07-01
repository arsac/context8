import { describe, expect, it } from "vitest";

import { ResponseCache } from "./cache.js";
import type { Config } from "./config.js";
import { Context7Client } from "./context7Client.js";
import { KeyManager } from "./keyManager.js";
import { makeHandlers, type ToolDeps } from "./tools.js";

function baseConfig(over: Partial<Config> = {}): Config {
  return {
    apiKeys: ["k1", "k2"],
    baseUrl: "https://example.test",
    cacheTtlMs: 60_000,
    cacheMax: 100,
    stateFile: null,
    maxWaitMs: 10_000,
    assumedLimit: 100,
    ...over,
  };
}

function deps(fetchFn: typeof fetch, over: Partial<ToolDeps> = {}): ToolDeps {
  const t = 1000;
  const now = () => t;
  const cfg = baseConfig();
  return {
    keyManager: new KeyManager(cfg.apiKeys, { assumedLimit: cfg.assumedLimit, now }),
    client: new Context7Client({ baseUrl: cfg.baseUrl, fetchFn, now }),
    cache: new ResponseCache({ maxEntries: cfg.cacheMax, ttlMs: cfg.cacheTtlMs, now }),
    config: cfg,
    now,
    sleep: async () => {},
    ...over,
  };
}

describe("makeHandlers", () => {
  it("returns the body on success and caches it (no second API call)", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls++;
      return new Response("DOCS", { status: 200 });
    };
    const h = makeHandlers(deps(fetchFn));
    expect(await h.queryDocs({ libraryId: "/vercel/next.js", query: "routing" })).toBe("DOCS");
    expect(await h.queryDocs({ libraryId: "/vercel/next.js", query: "routing" })).toBe("DOCS");
    expect(calls).toBe(1); // second call served from cache
  });

  it("fails over to the next key on 429", async () => {
    const seen: string[] = [];
    const fetchFn: typeof fetch = async (_input, init) => {
      // biome-ignore lint/style/noNonNullAssertion: test verifies Authorization header is present
      const auth = new Headers(init?.headers).get("Authorization")!;
      seen.push(auth);
      if (auth === "Bearer k1")
        return new Response("limited", { status: 429, headers: { "Retry-After": "30" } });
      return new Response("OK", { status: 200 });
    };
    // Force k1 first by leaving both fresh (k1 inserted first, equal estimate -> tie-break picks k1).
    const h = makeHandlers(deps(fetchFn));
    expect(await h.resolveLibraryId({ query: "x", libraryName: "Next.js" })).toBe("OK");
    expect(seen).toContain("Bearer k1");
    expect(seen).toContain("Bearer k2");
  });

  it("waits once then retries when all keys are cooling, then errors if still exhausted", async () => {
    let sleeps = 0;
    const fetchFn: typeof fetch = async () =>
      new Response("limited", { status: 429, headers: { "Retry-After": "1" } });
    const d = deps(fetchFn, {
      sleep: async () => {
        sleeps++;
      },
    });
    const h = makeHandlers(d);
    await expect(h.queryDocs({ libraryId: "/a/b", query: "q" })).rejects.toThrow(/rate-limited/i);
    expect(sleeps).toBe(1); // bounded single wait
  });

  it("never includes raw keys in the exhaustion error", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response("limited", { status: 429, headers: { "Retry-After": "1" } });
    const h = makeHandlers(deps(fetchFn));
    await h.queryDocs({ libraryId: "/a/b", query: "q" }).catch((e: Error) => {
      expect(e.message).not.toContain("k1");
      expect(e.message).not.toContain("k2");
    });
  });

  it("fails over across keys on 5xx and reports a non-rate-limit error", async () => {
    const seen: string[] = [];
    const fetchFn: typeof fetch = async (_input, init) => {
      seen.push(new Headers(init?.headers).get("Authorization") ?? "");
      return new Response("boom", { status: 500 });
    };
    const h = makeHandlers(deps(fetchFn));
    await expect(h.resolveLibraryId({ query: "x", libraryName: "Next.js" })).rejects.toThrow(
      /failed/i,
    );
    expect(seen).toContain("Bearer k1");
    expect(seen).toContain("Bearer k2");
    expect(seen.length).toBe(2); // exactly one attempt per key, no redundant call
  });

  it("fails over across keys on network errors", async () => {
    const seen: string[] = [];
    const fetchFn: typeof fetch = async (_input, init) => {
      seen.push(new Headers(init?.headers).get("Authorization") ?? "");
      throw new Error("network down");
    };
    const h = makeHandlers(deps(fetchFn));
    await expect(h.queryDocs({ libraryId: "/a/b", query: "q" })).rejects.toThrow(/network/i);
    expect(seen).toContain("Bearer k1");
    expect(seen).toContain("Bearer k2");
  });
});
