import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ResponseCache } from "./cache.js";
import type { Config } from "./config.js";
import type { Context7Client, Context7Response } from "./context7Client.js";
import type { KeyManager } from "./keyManager.js";

export interface ToolDeps {
  readonly keyManager: KeyManager;
  readonly client: Context7Client;
  readonly cache: ResponseCache;
  readonly config: Config;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface ResolveLibraryIdArgs {
  query: string;
  libraryName: string;
}

interface QueryDocsArgs {
  libraryId: string;
  query: string;
}

interface ToolHandlers {
  resolveLibraryId(args: ResolveLibraryIdArgs): Promise<string>;
  queryDocs(args: QueryDocsArgs): Promise<string>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeHandlers(deps: ToolDeps): ToolHandlers {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const { keyManager, client, cache, config } = deps;

  async function callWithRotation(
    cacheKey: string,
    call: (apiKey: string) => Promise<Context7Response>,
  ): Promise<string> {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const maxAttempts = config.apiKeys.length;
    let waited = false;
    let calls = 0;
    let lastStatus: number | null = null;

    while (true) {
      const key = keyManager.selectKey();
      if (key === null) {
        // All keys are cooling down. Wait once for the soonest reset, then retry the pool.
        if (waited) break;
        const resetAt = keyManager.nextResetAt();
        const waitMs = resetAt === null ? 0 : Math.min(resetAt - now(), config.maxWaitMs);
        if (waitMs <= 0) break;
        await sleep(waitMs);
        waited = true;
        continue;
      }

      // Cap at one call per key. Checked AFTER the null-check (so the wait branch stays
      // reachable when all keys cool) and BEFORE consuming a call (so there is no redundant call).
      if (calls >= maxAttempts) break;
      calls++;

      let resp: Context7Response;
      try {
        resp = await call(key);
      } catch {
        // Network error: no rate-limit info. Nudge the key so selectKey rotates, then fail over.
        keyManager.markUsed(key);
        lastStatus = 0;
        continue;
      }
      keyManager.recordResult(key, resp.status, resp.rateLimit);
      lastStatus = resp.status;

      if (resp.status === 200) {
        cache.set(cacheKey, resp.body);
        return resp.body;
      }
      if (resp.status === 429) {
        // recordResult set this key's cooldown; selectKey will rotate to another key.
        continue;
      }
      if (resp.status >= 500) {
        // 5xx does not cool the key; nudge it so selectKey rotates to another key.
        keyManager.markUsed(key);
        continue;
      }
      // Non-retryable 4xx.
      throw new Error(`Context7 request failed (${resp.status}): ${resp.body}`);
    }

    if (lastStatus === 0) {
      throw new Error("All Context7 API keys failed due to network errors.");
    }
    if (lastStatus !== null && lastStatus !== 429) {
      throw new Error(`All Context7 API keys failed (last status ${lastStatus}).`);
    }
    throw new Error("All Context7 API keys are rate-limited. Try again later.");
  }

  async function resolveLibraryId(args: ResolveLibraryIdArgs): Promise<string> {
    const cacheKey = `resolve:${args.libraryName.trim()}:${args.query.trim()}`;
    return callWithRotation(cacheKey, (key) => client.searchLibraries(args, key));
  }

  async function queryDocs(args: QueryDocsArgs): Promise<string> {
    const cacheKey = `docs:${args.libraryId.trim()}:${args.query.trim()}`;
    return callWithRotation(cacheKey, (key) => client.getContext(args, key));
  }

  return { resolveLibraryId, queryDocs };
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const handlers = makeHandlers(deps);

  server.tool(
    "resolve-library-id",
    "Resolves a package/product name to a Context7-compatible library ID and returns matching libraries.",
    { query: z.string(), libraryName: z.string() },
    async (args) => {
      const text = await handlers.resolveLibraryId(args);
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "query-docs",
    "Retrieves up-to-date documentation and code examples from Context7 for a library.",
    { libraryId: z.string(), query: z.string() },
    async (args) => {
      const text = await handlers.queryDocs(args);
      return { content: [{ type: "text", text }] };
    },
  );
}
