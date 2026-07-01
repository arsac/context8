import type { RateLimitInfo } from "./keyManager.js";

// Endpoint + param mapping. Reconcile against docs/context7-api-findings.md.
const SEARCH_PATH = "/api/v2/libs/search";
const CONTEXT_PATH = "/api/v2/context";

type Clock = () => number;

export interface Context7Response {
  readonly status: number;
  readonly body: string;
  readonly rateLimit: RateLimitInfo;
}

function numHeader(h: Headers, name: string): number | null {
  const v = h.get(name);
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseRateLimitHeaders(headers: Headers, now: number): RateLimitInfo {
  const resetSecs = numHeader(headers, "RateLimit-Reset");
  const retryAfterSecs = numHeader(headers, "Retry-After");
  return {
    limit: numHeader(headers, "RateLimit-Limit"),
    remaining: numHeader(headers, "RateLimit-Remaining"),
    resetAt: resetSecs === null ? null : now + resetSecs * 1000,
    retryAfterMs: retryAfterSecs === null ? null : retryAfterSecs * 1000,
  };
}

export class Context7Client {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: Clock;

  constructor(opts: { baseUrl: string; fetchFn?: typeof fetch; now?: Clock }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  private async request(
    path: string,
    params: Record<string, string>,
    apiKey: string,
  ): Promise<Context7Response> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await this.fetchFn(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json, text/plain" },
    });
    const body = await resp.text();
    return {
      status: resp.status,
      body,
      rateLimit: parseRateLimitHeaders(resp.headers, this.now()),
    };
  }

  searchLibraries(
    params: { query: string; libraryName: string },
    apiKey: string,
  ): Promise<Context7Response> {
    return this.request(SEARCH_PATH, params, apiKey);
  }

  getContext(
    params: { libraryId: string; query: string },
    apiKey: string,
  ): Promise<Context7Response> {
    return this.request(CONTEXT_PATH, params, apiKey);
  }
}
