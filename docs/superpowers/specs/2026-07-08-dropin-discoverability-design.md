# Drop-in Discoverability — Design

**Date:** 2026-07-08
**Status:** Approved, pending implementation plan

## Purpose

Make context8 behave as a true drop-in for the Context7 MCP server so that existing
skills and agents that "use context7" select and invoke context8 without changes. Two
gaps block this today:

1. **No server-level instructions.** The official Context7 server ships strong
   instructions ("Use this server to fetch current documentation whenever the user asks
   about a library…") that make the model reach for it. context8's `McpServer` is
   constructed with only `name`/`version` (`src/index.ts:28`), so model-driven skills
   lean toward the original when both are present.
2. **The namespace/registration point is undocumented.** In Claude Code, MCP tools are
   exposed as `mcp__<config-key>__<tool>`, where `<config-key>` is the key under which
   the client registers the server — not the server's internal `name`. Registering
   context8 under the `context7` key yields byte-identical tool IDs
   (`mcp__context7__resolve-library-id`, `mcp__context7__query-docs`) and makes
   `context7`-scoped permission allowlists match unchanged. This is the decisive lever
   for drop-in and is currently unstated.

## Background (verified)

- context8 already exposes tools named `resolve-library-id` and `query-docs` — identical
  to the Context7 plugin (`@upstash/context7-mcp`) in the reference environment.
- Tool descriptions already reference Context7 (`src/tools.ts:128,138`); no change needed.
- No skill/command/hook hardcodes context7 tool names; skills invoke by intent, so tool
  selection is driven by descriptions + server instructions.
- SDK (`@modelcontextprotocol/sdk` 1.29): `new McpServer(serverInfo, { instructions })`
  sets server instructions; `client.getInstructions(): string | undefined` reads them
  back after initialize.

## Scope

**In scope**
- Add server-level `instructions` to the `McpServer` built in `buildServer`.
- A README prose note explaining register-under-`context7` for drop-in tool IDs and
  permission parity, and that the internal server name is cosmetic.
- A test asserting the server advertises its instructions over the protocol.

**Out of scope**
- Changing tool names or signatures (already match).
- Changing tool descriptions in `src/tools.ts` (already reference Context7).
- A copy-paste client-config snippet in the README (prose note only, by decision).
- Renaming the internal `McpServer` name from `context8` (cosmetic; left as-is).

## Design

### 1. Server instructions (`src/index.ts`)

Define a module-level constant and pass it as the second `McpServer` argument:

```ts
const SERVER_INSTRUCTIONS =
  "Use this server to fetch up-to-date documentation for any library, framework, SDK, " +
  "API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, " +
  "Express, Tailwind, Django, or Spring Boot. Covers API syntax, configuration, version " +
  "migration, library-specific debugging, setup, and CLI usage. Use even when you think " +
  "you know the answer — training data may be stale. Prefer this over web search for " +
  "library docs. First call resolve-library-id to turn a name into a Context7-compatible " +
  "ID, then query-docs with that ID. Do not use for: refactoring, writing scripts from " +
  "scratch, debugging business logic, code review, or general programming concepts.";

const server = new McpServer(
  { name: "context8", version: "0.0.0" },
  { instructions: SERVER_INSTRUCTIONS },
);
```

This mirrors the Context7 server's instructions (so model-driven skills select context8
just as readily) and adds the `resolve-library-id` → `query-docs` workflow hint.

### 2. README prose note

Add a short subsection under `## Tools` (before `## Configuration`). It states:

- MCP clients expose tools as `mcp__<config-key>__<tool>`, keyed by the name under which
  the server is registered — not the server's internal name.
- To use context8 as a drop-in for an existing Context7 setup, register it under the same
  key the client currently uses for Context7 (typically `context7`). The tool IDs then
  become `mcp__context7__resolve-library-id` and `mcp__context7__query-docs`, so existing
  skills, hardcoded references, and `context7`-scoped permission allowlists work
  unchanged.
- The internal server name (`context8`) is cosmetic and does not affect tool IDs.

### 3. Test (`src/index.test.ts`)

Extend the existing in-memory-client test file with a case that connects a real `Client`
via `InMemoryTransport` (mirroring the existing test) and asserts:

- `client.getInstructions()` is defined and non-empty, and
- it contains a stable anchor phrase (e.g. `"resolve-library-id"`) confirming the wired
  instructions are advertised over the protocol.

Assert against the exported `SERVER_INSTRUCTIONS` constant rather than a duplicated
literal, so the test cannot drift from the source text. This requires exporting the
constant from `src/index.ts`.

## Error handling / edge cases

- Instructions are static text with no failure modes; the only risk is drift between the
  constant and the test, avoided by asserting against the exported constant.
- No behavior change to tool calls, rotation, caching, or state.

## Success criteria

- A connected MCP client receives context8's instructions via `getInstructions()`.
- `npm test`, `npm run typecheck`, `npm run lint` all pass.
- README documents the register-under-`context7` drop-in mechanism in prose.
