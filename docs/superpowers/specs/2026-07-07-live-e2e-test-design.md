# Live e2e Test — Design

**Date:** 2026-07-07
**Status:** Approved, pending implementation plan

## Purpose

Add a real end-to-end test that, given two live Context7 API keys, validates that
both MCP tools (`resolve-library-id`, `query-docs`) work against the live API and
that both provided keys independently authenticate.

This is not only regression coverage. Per `docs/context7-api-findings.md`, the API
endpoints and query-parameter names in `src/context7Client.ts` are **ASSUMED**, never
verified against the live API. This test is the first real signal that the wrapper's
request contract works end-to-end.

**What a green run does and does not prove.** The base URL is a live *website*, so a
wrong API path can still return `200` with an HTML page. The assertions therefore also
require the body to not look like HTML, which rules out that false green. A pass proves
requests authenticate and return real (non-HTML) content; it does **not** by itself
prove every query-parameter name is semantically correct — a tolerated-but-wrong param
could still yield a valid-looking body. So a green run is supporting evidence when
reconciling `docs/context7-api-findings.md`, not an automatic license to flip every
ASSUMED marker to CONFIRMED; confirm param semantics by spot-checking the returned
content.

## Scope

**In scope**
- One new test file exercising the tools through the real MCP protocol.
- A live check that each of the two keys returns HTTP 200 independently.
- Self-gating so the test is a no-op when live keys are absent.
- A README subsection documenting the live e2e: how to run it, and that it **silently
  skips** (reports as skipped, not failed) when fewer than two distinct keys are set —
  so a green `npm test` with no keys is not mistaken for a passing live run.

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
- Adding a fetch timeout / `AbortSignal` to `Context7Client` (a production-code change);
  and retries for transient 429/5xx (the spec accepts live nondeterminism). Possible
  follow-ups, not part of this task.

**Gating decision (reviewed).** The block gates on key presence only — it runs whenever
`parseApiKeys(process.env)` yields ≥2 keys. A reviewer flagged that a future keyed CI
job or a dev shell exporting `CONTEXT7_API_KEYS` would then make a plain `npm test` hit
the live API. The maintainer chose to keep keys-only gating (CI has no keys today); this
behavior is documented in the README so it is not a surprise.

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

Config is derived from `loadConfig()` but with `stateFile` forced to `null` for the
test: `{ ...loadConfig(), stateFile: null }`. This is deliberate — the sole cache/state
restore path in `buildServer` is `config.stateFile`, so nulling it guarantees the test
cannot be silently served a restored cache (false green) or a restored cooldown (false
red) from an ambient `CONTEXT7_STATE_FILE`, and never writes key state to disk. Each
`buildServer` call already constructs a fresh empty cache, so there is no intra-run
masking.

### A. Tools work through the MCP protocol

1. `buildServer({ ...loadConfig(), stateFile: null })`; link a real `Client` via
   `InMemoryTransport.createLinkedPair()`; connect client and server.
2. `client.listTools()` → assert the returned tool names include both
   `resolve-library-id` and `query-docs`.
3. `client.callTool({ name: "resolve-library-id", arguments: { libraryName: "next.js", query: "routing" } })`
   → assert the result is not an error (`isError` falsy), its text content is non-empty,
   and the text does not look like HTML (does not start with `<`).
4. `client.callTool({ name: "query-docs", arguments: { libraryId: "/vercel/next.js", query: "routing" } })`
   → assert not an error, text content non-empty, and not HTML.

On failure, the error body (from `result.content`) is passed as the assertion message so
a live failure shows *what* the API returned (401 / 404 / 5xx text), not just a bare
boolean mismatch. Assertions stay otherwise loose on body *content* (non-empty, non-HTML)
because the exact response format is ASSUMED — the test's job is to confirm requests
*succeed* end-to-end and return real content.

### B. Both keys valid (rotation prerequisite)

For each of the (first) two keys independently — `KEYS.slice(0, 2)`, so an environment
with more than two keys still only exercises two:
- Construct a `Context7Client({ baseUrl })` and call `searchLibraries({ query, libraryName }, key)`.
- Assert `status === 200` (a non-200 prints the status, pointing at the cause).

This proves both provided keys authenticate — not just the first — which is the
meaningful live-only signal about the rotation pool. The selection/cooldown algorithm
itself remains unit-tested.

## Details

- Per-test timeout ~30s to tolerate live network latency.
- Clean up transports/connections after each test (`finally { await client.close() }`).
- No new dependencies, scripts, or config files.
- Provide **two distinct** keys: `parseApiKeys` dedupes by value, so two identical keys
  collapse to one and the block skips. Documented in the README run instructions.

## Success criteria

- With two valid keys exported, `npm test` runs the block and all assertions pass.
- With no keys (or one), `npm test` skips the block and the rest of the suite is
  unaffected — no network calls, CI green.
- README documents the live run command and the silent-skip behavior.
