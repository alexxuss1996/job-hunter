import { drizzle } from "drizzle-orm/neon-http";

export function createDb(connectionString: string) {
  return drizzle(connectionString);
}

export type Db = ReturnType<typeof createDb>;
