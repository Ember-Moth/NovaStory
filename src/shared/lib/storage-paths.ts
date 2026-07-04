import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getStorageRoot() {
  return process.env.NOVEL_EVOLVER_DATA_DIR ?? join(__dirname, "../../../data");
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

export function getCatalogDir() {
  const dir = join(ensureStorageRoot(), "catalog");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getCatalogRegistryStatePath() {
  return join(getCatalogDir(), "registry-state.json");
}

export function getCatalogProviderDir() {
  const dir = join(getCatalogDir(), "providers");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getCatalogProviderPath(providerId: string) {
  return join(getCatalogProviderDir(), `${encodeURIComponent(providerId)}.json`);
}

export function getCatalogModelDir() {
  const dir = join(getCatalogDir(), "models");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getCatalogModelPath(modelId: string) {
  return join(getCatalogModelDir(), `${encodeURIComponent(modelId)}.json`);
}

export function ensureProjectStorageRoot() {
  const root = ensureStorageRoot();
  mkdirSync(join(root, "repos"), { recursive: true });
  return root;
}
