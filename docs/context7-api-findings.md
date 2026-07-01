# Context7 API v2 — Spike Findings

**Status:** ⚠️ **Not yet verified against the live API.** No Context7 API key was available
at authoring time. The values below are sourced from Context7 / ToolHive documentation and
marked **ASSUMED** or **CONFIRMED (docs)**. Anyone with a real key should run the probes in
the "Action items" section below and reconcile the constants in `src/context7Client.ts`
(`SEARCH_PATH`, `CONTEXT_PATH`, and the query-param names) plus the output formatting in
`src/tools.ts`.

## Endpoints

| Tool | Method + Path | Source |
|------|---------------|--------|
| `resolve-library-id` | `GET /api/v2/libs/search` | CONFIRMED (docs) |
| `query-docs` | `GET /api/v2/context` | CONFIRMED (docs) |

Base URL: `https://context7.com` (CONFIRMED, docs). The API migrated from
`https://api.context7.com/` to `https://context7.com/api/v2/`.

## Authentication

- Header: `Authorization: Bearer <API_KEY>` — CONFIRMED (docs).
- Anonymous use is possible at a lower anonymous rate limit; a key raises limits.

## Query parameters

⚠️ **All parameter names below are ASSUMED** — the single most important thing to verify
with a real key, because they determine whether requests succeed at all.

### `libs/search` (resolve-library-id)
- `query` — the search/ranking text. **ASSUMED.**
- `libraryName` — the library name to resolve. **ASSUMED** (the API may take only `query`;
  if `libraryName` is rejected, fold the library name into `query`).

### `context` (query-docs)
- `libraryId` — Context7-compatible ID, e.g. `/vercel/next.js`. **ASSUMED** (may be named
  `library` or passed as a path segment).
- `query` — the question/topic. **ASSUMED** (may be named `topic`).
- Possible extra params observed in older docs, not currently wired: `tokens`, `type`.
  Not needed for v1; add only if the spike shows they are required.

## Rate-limit response headers

CONFIRMED (docs) that on **HTTP 429** the response carries:

| Header | Meaning |
|--------|---------|
| `RateLimit-Limit` | total requests allowed in the window |
| `RateLimit-Remaining` | requests remaining in the current window |
| `RateLimit-Reset` | seconds until the window resets |
| `Retry-After` | seconds to wait before retrying |

⚠️ **UNCONFIRMED — the pivotal question for rotation:** whether `RateLimit-Remaining` (and
the other `RateLimit-*` headers) are also returned on **HTTP 200** responses. The IETF
`RateLimit-*` convention returns them on every response, but Context7's docs only describe
them in the 429 context.

- If present on 200 → `KeyManager` self-corrects `used`/`limit`/`windowResetAt` on every
  call and "most remaining" is near-exact.
- If 429-only → the wrapper relies on local `used++` accounting between 429s, correcting
  only when a 429 exposes real numbers. `KeyManager` already handles both paths; no code
  change is needed either way, but the accuracy of selection depends on this.

**Header unit note:** `context7Client.parseRateLimitHeaders` currently treats `RateLimit-Reset`
as **seconds** (`now + reset*1000`). Some servers emit `RateLimit-Reset` as an absolute Unix
timestamp instead. Verify which; if it is an absolute epoch, adjust the parser.

## Response bodies & output formatting

⚠️ **ASSUMED** pending the spike:
- `libs/search` returns JSON describing candidate libraries (id, name, description, code
  snippet count, source reputation, benchmark score, versions). The official MCP formats
  this into a human-readable text block. For v1, `tools.ts` returns the response body text
  as-is; once the spike confirms the JSON shape, replicate the upstream text formatting so
  `context8` is a true drop-in.
- `context` returns documentation text (likely `text/plain` or markdown). Returned as-is.

## Action items when a key is available

Run these probes (replace `$KEY`) and record the status, all response headers (especially
every `RateLimit-*`), and the JSON/text body shape:

```bash
# resolve-library-id path
curl -sS -D - -H "Authorization: Bearer $KEY" \
  "https://context7.com/api/v2/libs/search?query=Next.js"

# query-docs path — try libraryId/library/topic/tokens to see which params the API honors
curl -sS -D - -H "Authorization: Bearer $KEY" \
  "https://context7.com/api/v2/context?libraryId=/vercel/next.js&query=routing"
```

Then:
1. Confirm the exact accepted query-param names for each endpoint.
2. Pin `SEARCH_PATH`, `CONTEXT_PATH`, and every query-param name in `src/context7Client.ts`.
3. Confirm whether `RateLimit-*` headers appear on 200 and whether `RateLimit-Reset` is
   seconds vs an absolute timestamp; adjust `parseRateLimitHeaders` if needed.
4. Replicate the upstream output formatting in `src/tools.ts` for `resolve-library-id`.
5. Replace the ASSUMED/UNCONFIRMED markers above with CONFIRMED once observed.
