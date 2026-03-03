#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if echo "$COMMAND" | grep -qE '(npx|dlx|bunx) shadcn'; then
  echo "Blocked: use 'bun run ui add <component>' instead of calling shadcn directly." >&2
  exit 2
fi

exit 0
