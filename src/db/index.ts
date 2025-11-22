import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_PATH ?? "./db.sqlite";
const sqlite = new Database(dbPath);
export const db = drizzle({ client: sqlite, schema });

export type Tx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
