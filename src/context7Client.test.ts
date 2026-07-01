import { describe, expect, it } from "vitest";
import { Context7Client, parseRateLimitHeaders } from "./context7Client.js";

describe("parseRateLimitHeaders", () => {
  it("parses RateLimit headers and converts reset seconds to epoch ms", () => {
    const h = new Headers({
      "RateLimit-Limit": "50",
      "RateLimit-Remaining": "12",
      "RateLimit-Reset": "30",
      "Retry-After": "30",
    });
    const info = parseRateLimitHeaders(h, 1000);
    expect(info.limit).toBe(50);
    expect(info.remaining).toBe(12);
    expect(info.resetAt).toBe(1000 + 30 * 1000);
    expect(info.retryAfterMs).toBe(30 * 1000);
  });

  it("returns nulls when headers are absent", () => {
    const info = parseRateLimitHeaders(new Headers(), 0);
    expect(info).toEqual({ limit: null, remaining: null, resetAt: null, retryAfterMs: null });
  });
});

describe("Context7Client", () => {
  it("sends the bearer key and returns status + body + rateLimit", async () => {
    let captured: { url: string; auth: string | null } | null = null;
    const fakeFetch: typeof fetch = async (input, init) => {
      captured = {
        url: String(input),
        auth: new Headers(init?.headers).get("Authorization"),
      };
      return new Response("RESULT", {
        status: 200,
        headers: { "RateLimit-Remaining": "7" },
      });
    };
    const client = new Context7Client({
      baseUrl: "https://example.test",
      fetchFn: fakeFetch,
      now: () => 0,
    });
    const res = await client.searchLibraries(
      { query: "routing", libraryName: "Next.js" },
      "KEY123",
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe("RESULT");
    expect(res.rateLimit.remaining).toBe(7);
    expect(captured?.auth).toBe("Bearer KEY123");
    expect(captured?.url).toContain("/api/v2/libs/search");
    expect(captured?.url).toContain("Next.js");
  });

  it("passes through a 429 with its body", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("rate limited", { status: 429, headers: { "Retry-After": "5" } });
    const client = new Context7Client({
      baseUrl: "https://example.test",
      fetchFn: fakeFetch,
      now: () => 1000,
    });
    const res = await client.getContext({ libraryId: "/vercel/next.js", query: "routing" }, "KEY");
    expect(res.status).toBe(429);
    expect(res.rateLimit.retryAfterMs).toBe(5000);
  });
});
