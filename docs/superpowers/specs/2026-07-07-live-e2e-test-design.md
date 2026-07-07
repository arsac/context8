# Live e2e Test — Design

**Date:** 2026-07-07
**Status:** Approved, pending implementation plan

## Purpose

Add a real end-to-end test that, given two live Context7 API keys, validates that
both MCP tools (`resolve-library-id`, `query-docs`) work against the live API and
that both provided keys independently authenticate.

This is not only regression coverage. Per `docs/context7-api-findings.md`, the API
endpoints and query-parameter names in `src/context7Client.ts` are **ASSUMED**, never
verified against the live API. This test is the first real confirmation that the
wrapper's request contract is correct — a green run is evidence to flip the doc's
markers from ASSUMED to CONFIRMED.

## Scope

**In scope**
- One new test file exercising the tools through the real MCP protocol.
- A live check that each of the two keys returns HTTP 200 independently.
- Self-gating so the test is a no-op when live keys are absent.

**Out of scope**
- A dedicated `test:e2e` script or separate Vitest config (test runs under the
  normal `vitest run`, gated by env).
- `.env` loading / `dotenv`. Keys come from `process.env`, identical to how the
  server sources them via `loadConfig`/`parseApiKeys`.
- Forcing a 429 to observe cooldown/rotation live (nondeterministic). Selection and
  cooldown logic stay covered by the existing `src/keyManager.test.ts` unit tests.
- Parsing the resolve response to chain into `query-docs` (response body shape is
  unconfirmed; parsing would be brittle). A hardcoded well-known `libraryId` is used
  instead.
- Any CI job wiring. Default CI stays green with no network; a keyed job can be added
  later as separate work.

## Test layer decision

Exercise the tools through the **full MCP protocol in-process**, using the SDK's
canonical `InMemoryTransport`:

- `buildServer(config)` produces the real `McpServer` with real tool registration and
  real Zod validation.
- `InMemoryTransport.createLinkedPair()` links a real `Client` to that server in the
  same process — no subprocess, no stdio pipes.
- The only "real" dependency is the live API itself (real `Context7Client`, real keys).

This gives true protocol-path coverage while remaining an ordinary in-process Vitest
test. Spawning `dist/index.js` over stdio was rejected: it adds a build dependency and
subprocess management for no additional coverage of the request contract.

## File and gating

**File:** `src/e2e.test.ts` (matched by the existing `include: ["src/**/*.test.ts"]`).

**Gate:**
```ts
const KEYS = parseApiKeys(process.env);
describe.skipIf(KEYS.length < 2)("e2e (live Context7 API)", () => { ... });
```

When fewer than two keys are present (e.g. normal CI), the entire block is skipped —
no network, default CI stays green. It runs only when both keys are exported:
```
CONTEXT7_API_KEY_1=xxx CONTEXT7_API_KEY_2=yyy npm test
```

## Test cases

Config is obtained via `loadConfig()` so it mirrors the real server exactly (default
base URL, cache, no state file unless env overrides).

### A. Tools work through the MCP protocol

1. `buildServer(loadConfig())`; link a real `Client` via `InMemoryTransport.createLinkedPair()`;
   connect client and server.
2. `client.listTools()` → assert the returned tool names include both
   `resolve-library-id` and `query-docs`.
3. `client.callTool({ name: "resolve-library-id", arguments: { libraryName: "next.js", query: "routing" } })`
   → assert the result is not an error (`isError` falsy) and its text content is non-empty.
4. `client.callTool({ name: "query-docs", arguments: { libraryId: "/vercel/next.js", query: "routing" } })`
   → assert not an error and text content non-empty.

Assertions stay loose on body *content* (non-empty, not an error) because the response
format is ASSUMED. The test's job is to confirm requests *succeed* end-to-end.

### B. Both keys valid (rotation prerequisite)

For each of the two keys independently:
- Construct a `Context7Client({ baseUrl })` and call `searchLibraries({ query, libraryName }, key)`.
- Assert `status === 200`.

This proves both provided keys authenticate — not just the first — which is the
meaningful live-only signal about the rotation pool. The selection/cooldown algorithm
itself remains unit-tested.

## Details

- Per-test timeout ~30s to tolerate live network latency.
- Clean up transports/connections after each test (close the client).
- No new dependencies, scripts, or config files.

## Success criteria

- With two valid keys exported, `npm test` runs the block and all assertions pass.
- With no keys (or one), `npm test` skips the block and the rest of the suite is
  unaffected — no network calls, CI green.
