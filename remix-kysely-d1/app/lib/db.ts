import { Kysely } from "kysely";
import type { DB } from "kysely-codegen";
import { D1Dialect } from "kysely-d1";

export const getDb = (db: D1Database) =>
  new Kysely<DB>({ dialect: new D1Dialect({ database: db }) });
