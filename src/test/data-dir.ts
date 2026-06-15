import { afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let currentDataDir: string | null = null;
const TEST_DATA_DIR_HOOKS_KEY = "__NOVEL_EVOLVER_TEST_DATA_DIR_HOOKS__";

export function resetTestDataDir() {
  if (currentDataDir) {
    rmSync(currentDataDir, { recursive: true, force: true });
  }

  currentDataDir = mkdtempSync(join(tmpdir(), "novel-evolver-test-"));
  process.env.NOVEL_EVOLVER_DATA_DIR = currentDataDir;
  return currentDataDir;
}

export function cleanupTestDataDir() {
  if (!currentDataDir) return;

  rmSync(currentDataDir, { recursive: true, force: true });
  if (process.env.NOVEL_EVOLVER_DATA_DIR === currentDataDir) {
    delete process.env.NOVEL_EVOLVER_DATA_DIR;
  }
  currentDataDir = null;
}

export function getCurrentTestDataDir() {
  return currentDataDir;
}

export function setupGlobalTestDataDirIsolation() {
  const state = globalThis as typeof globalThis & {
    [TEST_DATA_DIR_HOOKS_KEY]?: boolean;
  };
  if (state[TEST_DATA_DIR_HOOKS_KEY]) {
    return;
  }

  state[TEST_DATA_DIR_HOOKS_KEY] = true;
  resetTestDataDir();

  beforeEach(() => {
    resetTestDataDir();
  });

  afterAll(() => {
    cleanupTestDataDir();
  });
}
