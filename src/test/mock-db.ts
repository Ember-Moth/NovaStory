import { Database } from "bun:sqlite";
import { beforeEach } from "bun:test";

import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import * as schema from "@/db/schema";

export type DatabaseClient = BunSQLiteDatabase<typeof schema>;
export type DatabaseExecutor =
  | DatabaseClient
  | Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

let currentSqlite!: Database;
let currentDb!: DatabaseClient;

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
