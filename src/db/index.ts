import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import * as schema from "./schema";

// Ensure the data directory exists
const dbDir = join(import.meta.dir, "../../data");
mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(join(dbDir, "sqlite.db"), { create: true });

// Enable WAL mode for better concurrent performance
sqlite.run("PRAGMA journal_mode = WAL;");

export const db = drizzle(sqlite, { schema });

// Automatically run pending migrations on startup
migrate(db, { migrationsFolder: "./drizzle" });

export { sqlite };
