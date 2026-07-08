import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { buildServer, SERVER_INSTRUCTIONS } from "./index.js";

describe("buildServer", () => {
  it("builds a server and registers exactly the two tools", async () => {
    const cfg = loadConfig({ CONTEXT7_API_KEYS: "k1,k2" } as NodeJS.ProcessEnv);
    const { server } = buildServer(cfg);

    // The installed SDK's Server#request() sends requests to the far end of a connected
    // transport rather than invoking its own registered handlers in-process, so there is no
    // way to call tools/list without a transport. Use the SDK's own Client + InMemoryTransport
    // linked pair to perform a real (in-process) tools/list round trip instead.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["query-docs", "resolve-library-id"]);
  });

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
});
