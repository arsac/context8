# Live e2e Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-gating live e2e test that, given two real Context7 API keys, validates both MCP tools work through the real protocol and that both keys independently authenticate.

**Architecture:** A single new Vitest file, `src/e2e.test.ts`, gated by `describe.skipIf` on the number of keys in `process.env`. It drives the real `McpServer` (from `buildServer`) through the SDK's in-process `InMemoryTransport` + `Client` (Test A), and calls `Context7Client.searchLibraries` directly with each key (Test B). No production code changes.

**Tech Stack:** TypeScript (ESM, Node 24), Vitest 4, `@modelcontextprotocol/sdk` 1.29 (`Client`, `InMemoryTransport`).

## Global Constraints

- Node `>=24`, ESM (`"type": "module"`) — all relative imports use the `.js` extension (e.g. `./config.js`).
- Test files match `src/**/*.test.ts` (from `vitest.config.ts`); the new file runs under the normal `npm test`.
- No `.env` / `dotenv`. Keys come from `process.env` via `parseApiKeys`/`loadConfig`, exactly as the server sources them.
- No new dependencies, npm scripts, or config files.
- Keys are read with `parseApiKeys(process.env)` (from `src/config.ts`); the two indexed vars are `CONTEXT7_API_KEY_1` and `CONTEXT7_API_KEY_2`.
- Body-content assertions stay loose (non-empty, not an error) because the API response shape is unconfirmed; the test confirms requests *succeed*.
- Lint/format is Biome; match the existing file style (double quotes, 2-space indent, trailing commas).

---

### Task 1: e2e file scaffold + Test A (tools work through MCP protocol)

**Files:**
- Create: `src/e2e.test.ts`
- Reference (do not modify): `src/index.test.ts` (pattern to mirror), `src/index.ts` (`buildServer`), `src/config.ts` (`loadConfig`, `parseApiKeys`), `src/tools.ts` (tool names + arg shapes)

**Interfaces:**
- Consumes:
  - `buildServer(config: Config): { server: McpServer; flush(): void }` from `./index.js`
  - `loadConfig(env?: NodeJS.ProcessEnv): Config` and `parseApiKeys(env: NodeJS.ProcessEnv): string[]` from `./config.js`
  - `Client` from `@modelcontextprotocol/sdk/client/index.js` — methods `connect(transport)`, `listTools(): Promise<{ tools: { name: string }[] }>`, `callTool(params): Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>`, `close()`
  - `InMemoryTransport.createLinkedPair(): [clientTransport, serverTransport]` from `@modelcontextprotocol/sdk/inMemory.js`
  - Tool names: `"resolve-library-id"` (args `{ query, libraryName }`), `"query-docs"` (args `{ libraryId, query }`)
- Produces: the gated `describe` block and a `connect()` helper that Task 2 adds a test into.

- [ ] **Step 1: Write the file with the gate and Test A**

Create `src/e2e.test.ts` with exactly this content:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig, parseApiKeys } from "./config.js";
import { buildServer } from "./index.js";

// Live e2e: hits the real Context7 API. Runs only when two real keys are present
// (e.g. CONTEXT7_API_KEY_1 / CONTEXT7_API_KEY_2). Skipped — a no-op with no network —
// in normal CI, keeping the default suite green.
const KEYS = parseApiKeys(process.env);
const TIMEOUT_MS = 30_000;

// A well-known Context7 library id (see docs/context7-api-findings.md). Hardcoded rather
// than parsed from the resolve response, whose body shape is not yet confirmed.
const KNOWN_LIBRARY_ID = "/vercel/next.js";

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

describe.skipIf(KEYS.length < 2)("e2e (live Context7 API)", () => {
  async function connect(): Promise<Client> {
    const { server } = buildServer(loadConfig());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "e2e-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  it(
    "registers both tools and both return real results",
    async () => {
      const client = await connect();
      try {
        const tools = await client.listTools();
        const names = tools.tools.map((t) => t.name).sort();
        expect(names).toEqual(["query-docs", "resolve-library-id"]);

        const resolved = await client.callTool({
          name: "resolve-library-id",
          arguments: { libraryName: "next.js", query: "routing" },
        });
        expect(resolved.isError ?? false).toBe(false);
        expect(textOf(resolved).length).toBeGreaterThan(0);

        const docs = await client.callTool({
          name: "query-docs",
          arguments: { libraryId: KNOWN_LIBRARY_ID, query: "routing" },
        });
        expect(docs.isError ?? false).toBe(false);
        expect(textOf(docs).length).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    },
    TIMEOUT_MS,
  );
});
```

- [ ] **Step 2: Run the suite to verify the block is skipped and everything else is green**

Run: `npm test`
Expected: PASS. Output shows the `e2e (live Context7 API)` block as skipped (no keys in the environment), and all existing tests pass. No network calls occur.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Lint the new file**

Run: `npm run lint`
Expected: no errors for `src/e2e.test.ts`. If Biome reports formatting, run `npm run format` and re-run `npm run lint`.

- [ ] **Step 5: (Optional, only if you have two live keys) Run the live path**

Run: `CONTEXT7_API_KEY_1=<key1> CONTEXT7_API_KEY_2=<key2> npm test`
Expected: the `e2e` block runs and its test passes. If it fails on a non-200 (e.g. the tool result is `isError`), the ASSUMED endpoint/param names in `src/context7Client.ts` are wrong — that is the test doing its job; reconcile against `docs/context7-api-findings.md` before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/e2e.test.ts
git commit -m "test: add live e2e for MCP tools via in-memory client"
```

---

### Task 2: Test B (both keys independently authenticate)

**Files:**
- Modify: `src/e2e.test.ts` (add a second `it` inside the existing `describe.skipIf` block)
- Reference (do not modify): `src/context7Client.ts` (`Context7Client`, `Context7Response`)

**Interfaces:**
- Consumes:
  - `Context7Client` from `./context7Client.js` — constructor `new Context7Client({ baseUrl: string })`; method `searchLibraries({ query, libraryName }, apiKey): Promise<{ status: number; body: string; rateLimit: ... }>`
  - `loadConfig()` for `baseUrl`; `KEYS` from Task 1
- Produces: nothing consumed downstream (final task).

- [ ] **Step 1: Add the failing-if-broken live test**

Add this import at the top of `src/e2e.test.ts`, alongside the existing imports (Biome sorts imports; run `npm run format` if the order needs fixing):

```ts
import { Context7Client } from "./context7Client.js";
```

Then add this second `it` inside the `describe.skipIf(...)` block, after the first test:

```ts
  it(
    "authenticates each of the two keys independently",
    async () => {
      const { baseUrl } = loadConfig();
      const client = new Context7Client({ baseUrl });
      for (const key of KEYS) {
        const resp = await client.searchLibraries(
          { query: "routing", libraryName: "next.js" },
          key,
        );
        expect(resp.status).toBe(200);
      }
    },
    TIMEOUT_MS,
  );
```

- [ ] **Step 2: Run the suite to verify still green (skipped without keys)**

Run: `npm test`
Expected: PASS. The `e2e` block is still skipped (no keys), suite green, no network.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors. Run `npm run format` first if Biome reports import ordering/formatting.

- [ ] **Step 5: (Optional, only with two live keys) Run the live path**

Run: `CONTEXT7_API_KEY_1=<key1> CONTEXT7_API_KEY_2=<key2> npm test`
Expected: both e2e tests pass. A non-200 for either key means that key is invalid or the search endpoint/params are wrong — reconcile as in Task 1 Step 5.

- [ ] **Step 6: Commit**

```bash
git add src/e2e.test.ts
git commit -m "test: verify both keys authenticate independently in e2e"
```

---

## Self-Review

**Spec coverage:**
- In-memory MCP protocol layer (`buildServer` + `Client` + `InMemoryTransport`) → Task 1. ✓
- `listTools` asserts both tools registered → Task 1. ✓
- `callTool` for both tools, non-error + non-empty → Task 1. ✓
- Hardcoded `libraryId`, no resolve-parsing → Task 1 (`KNOWN_LIBRARY_ID`). ✓
- Both keys authenticate independently via direct `searchLibraries` → Task 2. ✓
- Gate: `describe.skipIf(KEYS.length < 2)` with `parseApiKeys(process.env)` → Task 1. ✓
- Keys from `process.env`, no `.env` → Task 1 (`parseApiKeys(process.env)`, `loadConfig()`). ✓
- ~30s per-test timeout → Task 1 & 2 (`TIMEOUT_MS`). ✓
- Client cleanup → Task 1 (`finally { await client.close() }`). ✓
- No new deps/scripts/config → confirmed, only one file created. ✓
- Green/no-network in CI → Task 1 Step 2, Task 2 Step 2. ✓

**Placeholder scan:** No TBD/TODO; all code is complete and copy-paste ready.

**Type consistency:** `textOf`, `connect`, `KEYS`, `TIMEOUT_MS`, `KNOWN_LIBRARY_ID` defined in Task 1 and reused as-is in Task 2. Tool names (`query-docs`, `resolve-library-id`) and arg keys (`libraryName`/`query`, `libraryId`/`query`) match `src/tools.ts`. `Context7Client` constructor/`searchLibraries` signatures match `src/context7Client.ts`.
