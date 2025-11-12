import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/migrations",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./db.sqlite",
  },
});
