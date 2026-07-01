import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadState, type StateSnapshot, saveState } from "./state.js";

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(join(tmpdir(), "context8-"));
  dirs.push(d);
  return join(d, "state.json");
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const snap: StateSnapshot = {
  version: 1,
  keys: [
    {
      keyHash: "abc",
      limit: 50,
      used: 3,
      remaining: 47,
      windowResetAt: 0,
      cooldownUntil: 0,
      lastUsedAt: 10,
    },
  ],
  cache: [["docs:/a/b:q", { value: "DOCS", expiresAt: 99999 }]],
};

describe("state persistence", () => {
  it("returns null when the file does not exist", () => {
    expect(loadState(tmpFile())).toBeNull();
  });

  it("round-trips a snapshot atomically", () => {
    const p = tmpFile();
    saveState(p, snap);
    expect(loadState(p)).toEqual(snap);
  });

  it("returns null on wrong version", () => {
    const p = tmpFile();
    saveState(p, { ...snap, version: 1 });
    // Corrupt the version by rewriting:
    saveState(p, JSON.parse(JSON.stringify({ ...snap, version: 2 })) as StateSnapshot);
    expect(loadState(p)).toBeNull();
  });
});
