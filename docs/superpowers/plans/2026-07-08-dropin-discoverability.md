# Drop-in Discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make context8 a true drop-in for the Context7 MCP server by advertising server-level instructions and documenting the register-under-`context7` namespace mechanism.

**Architecture:** Add an exported `SERVER_INSTRUCTIONS` constant in `src/index.ts` and pass it to the `McpServer` constructor's options; assert it is advertised over the protocol via the existing in-memory `Client` test; document the config-key = tool-namespace mechanism in the README. No production behavior changes to tool calls, rotation, caching, or state.

**Tech Stack:** TypeScript (ESM, Node 24), Vitest 4, `@modelcontextprotocol/sdk` 1.29 (`McpServer` `instructions` option; `Client.getInstructions()`).

## Global Constraints

- Node `>=24`, ESM (`"type": "module"`) — relative imports use the `.js` extension (e.g. `./index.js`).
- Test files match `src/**/*.test.ts` (`vitest.config.ts`); tests run under `npm test`.
- No new dependencies, npm scripts, or config files.
- Do NOT change tool names or signatures (`resolve-library-id`, `query-docs`) or the tool descriptions in `src/tools.ts` — they already reference Context7 and match the upstream names.
- The internal `McpServer` name stays `"context8"` (cosmetic; does not affect tool IDs).
- Server instructions text is fixed (approved): mirrors Context7's, plus the `resolve-library-id` → `query-docs` workflow hint. Use the exact string in Task 1.
- Lint/format is Biome (double quotes, 2-space indent, trailing commas); match existing file style.
- The test asserts against the exported `SERVER_INSTRUCTIONS` constant (not a duplicated literal) so it cannot drift from the source.

---

### Task 1: Server instructions + protocol test

**Files:**
- Modify: `src/index.ts` (add exported constant; pass `instructions` to `McpServer`)
- Modify: `src/index.test.ts` (add a test asserting the instructions are advertised)
- Reference (do not modify): `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts` (`ServerOptions.instructions`), `.../client/index.d.ts` (`getInstructions()`)

**Interfaces:**
- Consumes:
  - `new McpServer(serverInfo, options?)` — `options` is `ServerOptions`, which accepts `instructions?: string`.
  - `Client.getInstructions(): string | undefined` — populated after `initialize` (i.e. after `connect`).
  - `InMemoryTransport.createLinkedPair()`, `Client`, `buildServer`, `loadConfig` — already imported/used in `src/index.test.ts`.
- Produces:
  - `export const SERVER_INSTRUCTIONS: string` from `src/index.ts` (imported by the test).

- [ ] **Step 1: Write the failing test**

In `src/index.test.ts`, change the import of `buildServer` to also import the new constant, and add a second test inside the existing `describe("buildServer", ...)` block.

Change the existing import line:

```ts
import { buildServer } from "./index.js";
```

to:

```ts
import { buildServer, SERVER_INSTRUCTIONS } from "./index.js";
```

Add this test after the existing `it(...)` block, still inside `describe("buildServer", ...)`:

```ts
  it("advertises server instructions over the protocol", async () => {
    const cfg = loadConfig({ CONTEXT7_API_KEYS: "k1,k2" } as NodeJS.ProcessEnv);
    const { server } = buildServer(cfg);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    // getInstructions() is populated from the initialize handshake (server -> client).
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    // Sanity: the text names the entry-point tool so the model learns the workflow.
    expect(SERVER_INSTRUCTIONS).toContain("resolve-library-id");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/index.test.ts`
Expected: FAIL. Because `SERVER_INSTRUCTIONS` is not yet exported from `./index.js`, the import is undefined — the assertion `expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS)` fails (server advertises no instructions → `getInstructions()` is `undefined`, and/or `SERVER_INSTRUCTIONS` is `undefined`). `npm run typecheck` would also flag the missing export.

- [ ] **Step 3: Add and export the constant, pass it to McpServer**

In `src/index.ts`, add the constant near the top of the module (after the imports, before `buildServer`):

```ts
export const SERVER_INSTRUCTIONS =
  "Use this server to fetch up-to-date documentation for any library, framework, SDK, " +
  "API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, " +
  "Express, Tailwind, Django, or Spring Boot. Covers API syntax, configuration, version " +
  "migration, library-specific debugging, setup, and CLI usage. Use even when you think " +
  "you know the answer — training data may be stale. Prefer this over web search for " +
  "library docs. First call resolve-library-id to turn a name into a Context7-compatible " +
  "ID, then query-docs with that ID. Do not use for: refactoring, writing scripts from " +
  "scratch, debugging business logic, code review, or general programming concepts.";
```

Then change the server construction inside `buildServer` from:

```ts
  const server = new McpServer({ name: "context8", version: "0.0.0" });
```

to:

```ts
  const server = new McpServer(
    { name: "context8", version: "0.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );
```

Leave the following `registerTools(...)` and `return { server, flush }` lines unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/index.test.ts`
Expected: PASS — both the existing "registers exactly the two tools" test and the new instructions test pass.

- [ ] **Step 5: Full suite, typecheck, lint**

Run: `npm test`
Expected: PASS, all tests green (the live e2e block, if present in this tree, skips with no keys).

Run: `npm run typecheck`
Expected: exits 0, no errors.

Run: `npm run lint`
Expected: no errors. If Biome reports formatting (e.g. string concatenation wrapping), run `npm run format` and re-run `npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "feat: advertise Context7-style server instructions"
```

---

### Task 2: README drop-in note

**Files:**
- Modify: `README.md` (add a subsection between `## Tools` and `## Configuration`)

**Interfaces:**
- Consumes: nothing. Produces: nothing consumed by code.

- [ ] **Step 1: Add the subsection**

In `README.md`, locate the end of the `## Tools` section — the line:

```markdown
Same names and input schemas as the official Context7 MCP.
```

Immediately after that line (and its following blank line), before `## Configuration`, insert:

```markdown
## Drop-in for an existing Context7 setup

MCP clients expose a server's tools as `mcp__<config-key>__<tool>`, where `<config-key>`
is the name you register the server under — **not** the server's internal name. context8's
tools are already named `resolve-library-id` and `query-docs`, matching Context7.

To use context8 as a drop-in, register it under the **same key your client uses for
Context7** (typically `context7`). The tool IDs then become
`mcp__context7__resolve-library-id` and `mcp__context7__query-docs`, so existing skills,
hardcoded tool references, and `context7`-scoped permission allowlists keep working
unchanged. The internal server name (`context8`) is cosmetic and does not affect tool IDs.

```

- [ ] **Step 2: Verify nothing else regressed**

Run: `npm run lint`
Expected: no errors (Biome does not lint Markdown by default; this confirms nothing else changed). Visually confirm the new `## Drop-in for an existing Context7 setup` section renders between `## Tools` and `## Configuration`, with balanced formatting and no stray fences.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document register-as-context7 drop-in mechanism"
```

---

## Self-Review

**Spec coverage:**
- Server-level `instructions` added to `McpServer` → Task 1 (Step 3). ✓
- Exported `SERVER_INSTRUCTIONS` constant, test asserts against it (no drift) → Task 1 (Steps 1, 3). ✓
- Instructions advertised over the protocol, verified via `client.getInstructions()` → Task 1 (Steps 1–4). ✓
- Approved instructions text used verbatim → Task 1 (Step 3). ✓
- README prose note on config-key = tool-namespace and register-as-`context7` → Task 2. ✓
- Internal server name unchanged (`context8`) → Task 1 (Step 3 keeps `name: "context8"`). ✓
- No tool name/signature/description changes → confirmed, only `src/index.ts`, `src/index.test.ts`, `README.md` touched. ✓
- No new deps/scripts/config → confirmed. ✓
- `npm test` / `typecheck` / `lint` pass → Task 1 (Step 5), Task 2 (Step 2). ✓

**Placeholder scan:** No TBD/TODO; all code and the full instructions string are present and copy-paste ready.

**Type consistency:** `SERVER_INSTRUCTIONS` (exported `string`) defined in Task 1 `src/index.ts` and imported in the same task's `src/index.test.ts`. `McpServer(serverInfo, { instructions })` matches `ServerOptions.instructions?: string`. `Client.getInstructions(): string | undefined` — the test compares its result to the exported string; when advertised it is defined, so `toBe(SERVER_INSTRUCTIONS)` holds.
