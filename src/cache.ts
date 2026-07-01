type Clock = () => number;
export interface CacheEntry {
  readonly value: string;
  readonly expiresAt: number;
}

export class ResponseCache {
  private readonly map = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: Clock;

  constructor(opts: { maxEntries: number; ttlMs: number; now?: Clock }) {
    this.maxEntries = opts.maxEntries;
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  get(key: string): string | undefined {
    if (this.ttlMs === 0) return undefined;
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Touch for LRU ordering.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string): void {
    if (this.ttlMs === 0) return;
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  snapshot(): Array<[string, CacheEntry]> {
    return [...this.map.entries()];
  }

  restore(entries: Array<[string, CacheEntry]>): void {
    for (const [k, e] of entries) this.map.set(k, e);
  }
}
