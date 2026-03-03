#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if echo "$COMMAND" | grep -qE '(^|[;&|] *)eslint '; then
  echo "Blocked: use 'bun run check' or 'bun run fix' instead of calling eslint directly." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE '(^|[;&|] *)biome (check|lint|format)'; then
  echo "Blocked: use 'bun run check' or 'bun run fix' instead of calling biome directly." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE '(^|[;&|] *)prettier '; then
  echo "Blocked: use 'bun run check' or 'bun run fix' instead of calling prettier directly." >&2
  exit 2
fi

exit 0
