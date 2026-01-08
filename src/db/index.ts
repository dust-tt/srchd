import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_PATH ?? "./db.sqlite";
const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent access
sqlite.pragma("journal_mode = WAL");

// Set busy timeout to 5 seconds to handle concurrent writes
sqlite.pragma("busy_timeout = 5000");


export const db = drizzle({ client: sqlite, schema });

export type Tx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
