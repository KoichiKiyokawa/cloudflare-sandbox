#!/bin/bash

migration_name=$1
if [ -z "$1" ]; then
  read -p "Enter migration name: " migration_name
fi

pnpm atlas migrate diff --to file://db/schema.sql --dev-url "sqlite://file?mode=memory" $migration_name
