#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if echo "$COMMAND" | grep -qE '(^|[;&|] *)vitest '; then
  echo "Blocked: use 'bun run test' instead of calling vitest directly." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE '(^|[;&|] *)jest '; then
  echo "Blocked: use 'bun run test' instead of calling jest directly." >&2
  exit 2
fi

exit 0
