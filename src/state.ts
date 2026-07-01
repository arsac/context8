import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CacheEntry } from "./cache.js";
import type { KeyState } from "./keyManager.js";

export interface StateSnapshot {
  readonly version: 1;
  readonly keys: KeyState[];
  readonly cache: Array<[string, CacheEntry]>;
}

export function loadState(path: string): StateSnapshot | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StateSnapshot;
    if (parsed.version !== 1 || !Array.isArray(parsed.keys) || !Array.isArray(parsed.cache))
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(path: string, snapshot: StateSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot), "utf8");
  renameSync(tmp, path);
}
