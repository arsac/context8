# context8

A quota-aware [Context7](https://context7.com) MCP wrapper. It mirrors the official Context7
MCP tools (`resolve-library-id`, `query-docs`) exactly, but holds a **pool of API keys** and
routes each call to the key with the most remaining quota — failing over on rate limits,
self-correcting from `RateLimit-*` response headers, and caching successful responses so
repeated lookups consume **zero** quota. It's a drop-in replacement for the official server,
designed to deploy via the [ToolHive](https://docs.stacklok.com/toolhive/) `MCPServer` CRD.

## Tools

- **`resolve-library-id`** `{ query, libraryName }` — resolve a library name to a
  Context7-compatible ID.
- **`query-docs`** `{ libraryId, query }` — fetch up-to-date documentation for a library.

Same names and input schemas as the official Context7 MCP.

## Drop-in for an existing Context7 setup

MCP clients expose a server's tools as `mcp__<config-key>__<tool>`, where `<config-key>`
is the name you register the server under — **not** the server's internal name. context8's
tools are already named `resolve-library-id` and `query-docs`, matching Context7.

To use context8 as a drop-in, register it under the **same key your client uses for
Context7** (typically `context7`). The tool IDs then become
`mcp__context7__resolve-library-id` and `mcp__context7__query-docs`, so existing skills,
hardcoded tool references, and `context7`-scoped permission allowlists keep working
unchanged. The internal server name (`context8`) is cosmetic and does not affect tool IDs.

## Configuration

Keys are read from three sources and **merged + deduped** (first-seen order preserved), so the
simple case, the Kubernetes separate-Secrets case, and drop-in migration all work:

| Source | Example | Notes |
|--------|---------|-------|
| `CONTEXT7_API_KEYS` | `k1,k2,k3` | Comma-separated list (primary). |
| `CONTEXT7_API_KEY_1`, `CONTEXT7_API_KEY_2`, … | `k1` | Indexed; numerically sorted. Map each from a separate Secret. |
| `CONTEXT7_API_KEY` | `k1` | Singular; drop-in compatibility with the official server. |

At least one key is required, or the server exits at startup.

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONTEXT7_BASE_URL` | `https://context7.com` | API base URL. |
| `CONTEXT7_CACHE_TTL` | `3600` (seconds) | Response cache TTL. `0` disables caching. |
| `CONTEXT7_CACHE_MAX` | `500` | Max cached entries (LRU eviction). |
| `CONTEXT7_STATE_FILE` | _(unset)_ | Path for persisted rotation/cache state. Unset = in-memory only. |
| `CONTEXT7_MAX_WAIT_MS` | `10000` | Max wait when all keys are cooling down. |
| `CONTEXT7_ASSUMED_LIMIT` | `100` | Fallback per-window limit when the real limit is unknown. |

## Run locally (from source)

```bash
npm ci
npm run build
CONTEXT7_API_KEYS=key1,key2 node dist/index.js
```

The server speaks the MCP protocol over **stdio**. Point your MCP client at that command.

## Run with Docker

```bash
docker build -t context8 .
docker run --rm -e CONTEXT7_API_KEYS=key1,key2 -i context8
```

The published image is `ghcr.io/<owner>/context8` (multi-arch: `linux/amd64`, `linux/arm64`).

## Deploy with ToolHive

Sample manifests live in [`deploy/`](deploy/):

1. Create the API-keys Secret (`deploy/secret.example.yaml`):
   ```bash
   kubectl -n toolhive-system apply -f deploy/secret.example.yaml   # after filling in your keys
   ```
2. Apply the `MCPServer` (`deploy/mcpserver.yaml`) — set `spec.image` to
   `ghcr.io/<owner>/context8:latest`. It uses stdio transport (ToolHive fronts it with an HTTP
   proxy) and maps the Secret to `CONTEXT7_API_KEYS`.
3. Optionally apply the egress `NetworkPolicy` (`deploy/networkpolicy.yaml`) to allow outbound
   `context7.com:443`.

### Single-replica constraint

Rotation accounting is **per-process**, so context8 is correct only with a **single backend
replica** (`spec.backendReplicas: 1`, which stdio's single-connection model already encourages).
Running multiple replicas fragments the quota counters across pods and can over-use a key.
Multi-replica shared state (e.g. Redis) is out of scope for v1.

### State persistence

By default, rotation state is in-memory and self-corrects from real `RateLimit-*` headers after
a restart. To persist it across restarts, mount a volume and set `CONTEXT7_STATE_FILE` to a path
on it (see the commented `podTemplateSpec` in `deploy/mcpserver.yaml`). State is written
atomically on **graceful shutdown** (SIGTERM/SIGINT) — the path k8s uses for rolling updates and
evictions. A hard crash (SIGKILL/OOM) loses since-startup state, which then self-corrects from
response headers.

## How rotation works

For each call: check the cache → pick the non-cooling key with the most estimated remaining
quota → call Context7 → record the result. On a `200`, cache it and return. On `429`, cool the
key down (per `Retry-After`/`RateLimit-Reset`) and fail over. On `5xx`/network errors, rotate to
another key. When every key is cooling, wait once for the soonest reset (bounded by
`CONTEXT7_MAX_WAIT_MS`), then retry — otherwise return a clear error. Quota estimates
self-correct whenever the API returns `RateLimit-*` headers.

> **Note:** The Context7 v2 API query-parameter names, response shapes, and whether
> `RateLimit-Remaining` appears on successful responses are documented as assumptions in
> [`docs/context7-api-findings.md`](docs/context7-api-findings.md)
> and should be reconciled against the live API with a real key.

## Development

```bash
npm ci
npm run test        # Vitest
npm run lint        # Biome (lint + format check)
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
```
