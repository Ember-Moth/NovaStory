import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { getStorageRoot } from "@/shared/lib/storage-paths";

const __dirname = dirname(fileURLToPath(import.meta.url));
const storageRootAtImport = getStorageRoot();
const envDataDirAtImport = process.env.NOVEL_EVOLVER_DATA_DIR;
const defaultDataDir = resolve(__dirname, "../../data");
let firstTestRoot: string | null = null;

test("test preload isolates storage before test modules import", () => {
  expect(envDataDirAtImport).toBeDefined();
  expect(storageRootAtImport).toBe(envDataDirAtImport!);
  expect(storageRootAtImport).not.toBe(defaultDataDir);
  expect(storageRootAtImport.startsWith(join(tmpdir(), "novel-evolver-test-"))).toBe(true);
});

test("each test gets a fresh storage root", () => {
  const currentRoot = getStorageRoot();
  if (firstTestRoot == null) {
    firstTestRoot = currentRoot;
    expect(currentRoot.startsWith(join(tmpdir(), "novel-evolver-test-"))).toBe(true);
    return;
  }

  expect(currentRoot).not.toBe(firstTestRoot);
});
