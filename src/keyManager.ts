import { createHash } from "node:crypto";

type Clock = () => number;

export interface RateLimitInfo {
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetAt: number | null;
  readonly retryAfterMs: number | null;
}

export interface KeyState {
  keyHash: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  windowResetAt: number;
  cooldownUntil: number;
  lastUsedAt: number;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

export class KeyManager {
  private readonly assumedLimit: number;
  private readonly now: Clock;
  private readonly byHash = new Map<string, KeyState>();
  private readonly rawByHash = new Map<string, string>();

  constructor(keys: string[], opts: { assumedLimit: number; now?: Clock }) {
    this.assumedLimit = opts.assumedLimit;
    this.now = opts.now ?? Date.now;
    for (const key of keys) {
      const h = hashKey(key);
      this.rawByHash.set(h, key);
      this.byHash.set(h, {
        keyHash: h,
        limit: null,
        used: 0,
        remaining: null,
        windowResetAt: 0,
        cooldownUntil: 0,
        lastUsedAt: 0,
      });
    }
  }

  private roll(s: KeyState): void {
    if (s.windowResetAt > 0 && this.now() >= s.windowResetAt) {
      s.used = 0;
      s.remaining = null;
      s.windowResetAt = 0;
    }
  }

  private estimatedRemaining(s: KeyState): number {
    const limit = s.limit ?? this.assumedLimit;
    return Math.max(0, limit - s.used);
  }

  selectKey(): string | null {
    const now = this.now();
    let best: KeyState | null = null;
    for (const s of this.byHash.values()) {
      this.roll(s);
      if (s.cooldownUntil > now) continue;
      if (best === null) {
        best = s;
        continue;
      }
      const er = this.estimatedRemaining(s);
      const eb = this.estimatedRemaining(best);
      if (
        er > eb ||
        (er === eb && s.windowResetAt < best.windowResetAt) ||
        (er === eb && s.windowResetAt === best.windowResetAt && s.lastUsedAt < best.lastUsedAt)
      ) {
        best = s;
      }
    }
    return best ? (this.rawByHash.get(best.keyHash) ?? null) : null;
  }

  nextResetAt(): number | null {
    let soonest: number | null = null;
    for (const s of this.byHash.values()) {
      if (s.cooldownUntil > 0 && (soonest === null || s.cooldownUntil < soonest)) {
        soonest = s.cooldownUntil;
      }
    }
    return soonest;
  }

  recordResult(key: string, status: number, info: RateLimitInfo): void {
    const s = this.byHash.get(hashKey(key));
    if (!s) return;
    this.roll(s);
    const now = this.now();
    if (info.limit !== null) s.limit = info.limit;
    if (info.resetAt !== null) s.windowResetAt = info.resetAt;
    if (info.remaining !== null) {
      s.remaining = info.remaining;
      if (s.limit !== null) s.used = Math.max(0, s.limit - info.remaining);
    }
    if (status === 200) {
      if (info.remaining === null) s.used += 1;
      s.lastUsedAt = now;
    } else if (status === 429) {
      const cooldownMs = info.retryAfterMs ?? (info.resetAt !== null ? info.resetAt - now : 1000);
      s.cooldownUntil = now + Math.max(0, cooldownMs);
      s.lastUsedAt = now;
    }
  }

  markUsed(key: string): void {
    const s = this.byHash.get(hashKey(key));
    if (!s) return;
    this.roll(s);
    s.used += 1;
    s.lastUsedAt = this.now();
  }

  snapshot(): KeyState[] {
    return [...this.byHash.values()].map((s) => ({ ...s }));
  }

  restore(states: KeyState[]): void {
    for (const incoming of states) {
      const existing = this.byHash.get(incoming.keyHash);
      if (existing) Object.assign(existing, incoming);
    }
  }
}
