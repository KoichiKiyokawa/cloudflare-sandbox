#!/bin/bash

if [ -z "$1" ]; then
  echo "Usage: $0 <migration-name>"
  exit 1
fi

# Check if atlas is installed
if ! command -v atlas &> /dev/null; then
  brew install ariga/tap/atlas
fi

rm -rf tmp.db
touch tmp.db
for file in migrations/*.sql; do
  sqlite3 tmp.db < $file
done
atlas migrate diff --to file://db/schema.sql --dev-url sqlite3://tmp.db $1
rm -rf tmp.db
