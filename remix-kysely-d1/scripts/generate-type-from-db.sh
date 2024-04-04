#!/bin/bash

rm -rf tmp.db
sqlite3 tmp.db < db/schema.sql
DATABASE_URL=tmp.db pnpm kysely-codegen
rm -rf tmp.db