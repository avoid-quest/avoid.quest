import "server-only";
import { createClient } from "@libsql/client/web";
import { Kysely } from "kysely";
import { LibsqlDialect } from "kysely-libsql";
import type { Database } from "./types";

let db: Kysely<Database> | null = null;

export const getDb = () => {
  if (!(process.env.TURSO_CONNECTION_URL && process.env.TURSO_AUTH_TOKEN)) {
    throw new Error("TURSO_CONNECTION_URL and TURSO_AUTH_TOKEN must be set");
  }
  if (!db) {
    const client = createClient({
      url: process.env.TURSO_CONNECTION_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    db = new Kysely<Database>({
      dialect: new LibsqlDialect({ client }),
    });
  }
  return db;
};
