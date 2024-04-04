import { Generated, Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

interface Database {
  users: {
    id: Generated<number>;
    name: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
}

export const getDb = (db: D1Database) =>
  new Kysely<Database>({ dialect: new D1Dialect({ database: db }) });
