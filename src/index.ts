import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ResponseCache } from "./cache.js";
import { type Config, loadConfig } from "./config.js";
import { Context7Client } from "./context7Client.js";
import { KeyManager } from "./keyManager.js";
import { loadState, saveState } from "./state.js";
import { registerTools } from "./tools.js";

export const SERVER_INSTRUCTIONS =
  "Use this server to fetch up-to-date documentation for any library, framework, SDK, " +
  "API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, " +
  "Express, Tailwind, Django, or Spring Boot. Covers API syntax, configuration, version " +
  "migration, library-specific debugging, setup, and CLI usage. Use even when you think " +
  "you know the answer — training data may be stale. Prefer this over web search for " +
  "library docs. First call resolve-library-id to turn a name into a Context7-compatible " +
  "ID, then query-docs with that ID. Do not use for: refactoring, writing scripts from " +
  "scratch, debugging business logic, code review, or general programming concepts.";

export function buildServer(config: Config): { server: McpServer; flush(): void } {
  const keyManager = new KeyManager(config.apiKeys, { assumedLimit: config.assumedLimit });
  const cache = new ResponseCache({ maxEntries: config.cacheMax, ttlMs: config.cacheTtlMs });
  const client = new Context7Client({ baseUrl: config.baseUrl });

  let flush = () => {};
  if (config.stateFile) {
    const stateFile = config.stateFile;
    const restored = loadState(stateFile);
    if (restored) {
      keyManager.restore(restored.keys);
      cache.restore(restored.cache);
    }
    // Persist on graceful shutdown (see main's SIGTERM/SIGINT handler).
    flush = () =>
      saveState(stateFile, { version: 1, keys: keyManager.snapshot(), cache: cache.snapshot() });
  }

  const server = new McpServer(
    { name: "context8", version: "0.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, { keyManager, client, cache, config });
  return { server, flush };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { server, flush } = buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  function shutdown(): void {
    try {
      flush();
    } finally {
      process.exit(0);
    }
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Run only when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
