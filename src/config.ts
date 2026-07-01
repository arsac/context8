export interface Config {
  readonly apiKeys: string[];
  readonly baseUrl: string;
  readonly cacheTtlMs: number;
  readonly cacheMax: number;
  readonly stateFile: string | null;
  readonly maxWaitMs: number;
  readonly assumedLimit: number;
}

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

export function parseApiKeys(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  function add(v: string | undefined): void {
    if (!v) return;
    for (const part of v.split(",")) {
      const k = part.trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }

  add(env.CONTEXT7_API_KEYS);

  const indexed = Object.keys(env)
    .map((name) => {
      const m = /^CONTEXT7_API_KEY_(\d+)$/.exec(name);
      return m ? { idx: Number(m[1]), name } : null;
    })
    .filter((x): x is { idx: number; name: string } => x !== null)
    .sort((a, b) => a.idx - b.idx);
  for (const { name } of indexed) add(env[name]);

  add(env.CONTEXT7_API_KEY);

  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKeys = parseApiKeys(env);
  if (apiKeys.length === 0) {
    throw new Error(
      "No Context7 API key configured. Set CONTEXT7_API_KEYS, CONTEXT7_API_KEY_N, or CONTEXT7_API_KEY.",
    );
  }
  const stateFile = env.CONTEXT7_STATE_FILE?.trim();
  return {
    apiKeys,
    baseUrl: env.CONTEXT7_BASE_URL?.trim() || "https://context7.com",
    cacheTtlMs: num(env, "CONTEXT7_CACHE_TTL", 3600) * 1000,
    cacheMax: num(env, "CONTEXT7_CACHE_MAX", 500),
    stateFile: stateFile ? stateFile : null,
    maxWaitMs: num(env, "CONTEXT7_MAX_WAIT_MS", 10000),
    assumedLimit: num(env, "CONTEXT7_ASSUMED_LIMIT", 100),
  };
}
