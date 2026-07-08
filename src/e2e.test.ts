import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig, parseApiKeys } from "./config.js";
import { buildServer } from "./index.js";

// Live e2e: hits the real Context7 API. Runs only when two distinct real keys are
// present (e.g. CONTEXT7_API_KEY_1 / CONTEXT7_API_KEY_2). Skipped — a no-op with no
// network — in normal CI, keeping the default suite green.
const KEYS = parseApiKeys(process.env);
const TIMEOUT_MS = 30_000;

// A well-known Context7 library id (see docs/context7-api-findings.md). Hardcoded rather
// than parsed from the resolve response, whose body shape is not yet confirmed.
const KNOWN_LIBRARY_ID = "/vercel/next.js";

type CallToolResult = { content: { type: string; text?: string }[]; isError?: boolean };

function textOf(result: CallToolResult): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

// A wrong API path on the live *website* base URL can 200 an HTML page; assert real
// (non-HTML) content so that does not read as a false pass. The error body is passed as
// the assertion message so a live failure shows what the API actually returned.
function expectRealContent(result: CallToolResult): void {
  const text = textOf(result);
  expect(result.isError ?? false, text).toBe(false);
  expect(text.length, "empty response body").toBeGreaterThan(0);
  expect(text.trimStart().startsWith("<"), `looks like HTML: ${text.slice(0, 200)}`).toBe(false);
}

describe.skipIf(KEYS.length < 2)("e2e (live Context7 API)", () => {
  async function connect(): Promise<Client> {
    // stateFile: null so an ambient CONTEXT7_STATE_FILE cannot restore a cached body
    // (false green) or a cooldown (false red), and no key state is written to disk.
    const { server } = buildServer({ ...loadConfig(), stateFile: null });
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
        expectRealContent(resolved);

        const docs = await client.callTool({
          name: "query-docs",
          arguments: { libraryId: KNOWN_LIBRARY_ID, query: "routing" },
        });
        expectRealContent(docs);
      } finally {
        await client.close();
      }
    },
    TIMEOUT_MS,
  );
});
