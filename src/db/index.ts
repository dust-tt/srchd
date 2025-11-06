import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database("./db.sqlite");
export const db = drizzle({ client: sqlite, schema });

// Run migrations on initialization with error handling
try {
  migrate(db, { migrationsFolder: "./src/migrations" });
} catch (error) {
  console.error("Failed to run database migrations:", error);
  throw error;
}

export type Tx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
