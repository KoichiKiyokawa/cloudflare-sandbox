import { Kysely } from "kysely"
import { D1Dialect } from "kysely-d1"

export const db = new Kysely<Database>({ dialect: new D1Dialect({ database: env.DB }) })
