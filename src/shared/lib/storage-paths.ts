import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function getStorageRoot() {
  return process.env.NOVEL_EVOLVER_DATA_DIR ?? join(import.meta.dir, "../../../data");
}

export function ensureStorageRoot() {
  const root = getStorageRoot();
  mkdirSync(root, { recursive: true });
  return root;
}

export function ensureConfigDir() {
  const dir = join(ensureStorageRoot(), "config");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getConfigFilePath(filename: string) {
  return join(ensureConfigDir(), filename);
}

export function getSqlitePath() {
  return join(ensureStorageRoot(), "sqlite.db");
}

export function ensureProjectStorageRoot() {
  const root = ensureStorageRoot();
  mkdirSync(join(root, "repos"), { recursive: true });
  mkdirSync(join(root, "worktrees"), { recursive: true });
  return root;
}
