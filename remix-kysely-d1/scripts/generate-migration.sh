#!/bin/bash

if [ -z "$1" ]; then
  echo "Usage: $0 <migration-name>"
  exit 1
fi

# Check if atlas is installed
if ! command -v atlas &> /dev/null; then
  brew install ariga/tap/atlas
fi

atlas migrate diff --to file://db/schema.sql --dev-url "sqlite://file?mode=memory" $1
