import { Database } from "bun:sqlite";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { getSqlitePath } from "@/shared/lib/storage-paths";

import * as schema from "./schema";

const sqlite = new Database(process.env.DATABASE_URL ?? getSqlitePath(), { create: true });

// Enforce relational integrity for Drizzle foreign keys.
sqlite.run("PRAGMA foreign_keys = ON;");

// Enable WAL mode for better concurrent performance
sqlite.run("PRAGMA journal_mode = WAL;");

export const db = drizzle(sqlite, { schema });

// Automatically run pending migrations on startup
migrate(db, { migrationsFolder: "./drizzle" });

export type DatabaseClient = typeof db;
export type DatabaseExecutor =
  | DatabaseClient
  | Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export { schema, sqlite };
