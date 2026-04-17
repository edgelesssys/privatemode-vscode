#!/usr/bin/env bash
set -euo pipefail

PACKAGE_JSON="${1:-package.json}"

CURRENT=$(jq -r .version "$PACKAGE_JSON")
IFS='.' read -r MAJOR MINOR _ <<< "$CURRENT"
NEXT="${MAJOR}.$((MINOR + 1)).0"

jq --tab --arg v "$NEXT" '.version = $v' "$PACKAGE_JSON" > tmp.$$.json && mv tmp.$$.json "$PACKAGE_JSON"

echo "Bumped version: ${CURRENT} -> ${NEXT}"
