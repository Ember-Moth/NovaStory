import { Database } from "bun:sqlite";
import { beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import * as schema from "@/db/schema";

export type DatabaseClient = BunSQLiteDatabase<typeof schema>;
export type DatabaseExecutor =
  | DatabaseClient
  | Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

let currentSqlite!: Database;
let currentDb!: DatabaseClient;
let currentDataDir: string | null = null;

function createStableProxy<T extends object>(getCurrent: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const current = getCurrent();
      const value = Reflect.get(current, prop, current);
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
}

const db = createStableProxy(() => currentDb);
const sqlite = createStableProxy(() => currentSqlite);

export function resetMockDatabase() {
  currentSqlite?.close();
  if (currentDataDir) {
    rmSync(currentDataDir, { recursive: true, force: true });
  }
  currentDataDir = mkdtempSync(join(tmpdir(), "novel-evolver-test-"));
  process.env.NOVEL_EVOLVER_DATA_DIR = currentDataDir;
  currentSqlite = new Database(":memory:", { create: true });
  currentSqlite.run("PRAGMA foreign_keys = ON;");
  currentDb = drizzle(currentSqlite, { schema });
  migrate(currentDb, { migrationsFolder: "./drizzle" });
}

resetMockDatabase();

export function setupMockDatabase() {
  beforeEach(() => {
    resetMockDatabase();
  });
}

export const mockedDbModule = {
  db,
  sqlite,
  schema,
};
