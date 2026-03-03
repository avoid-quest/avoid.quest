#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if echo "$COMMAND" | grep -qE '(^|[;&|] *)tsc( |$)'; then
  echo "Blocked: use 'bun run typecheck' instead of calling tsc directly." >&2
  exit 2
fi

exit 0
