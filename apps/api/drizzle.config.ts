import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // .env.local is optional when the URL is passed in the environment.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
});
