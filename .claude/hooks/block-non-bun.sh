#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if echo "$COMMAND" | grep -qE '(^|[;&|] *)npm '; then
  echo "Blocked: use 'bun' instead of 'npm'." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE '(^|[;&|] *)yarn '; then
  echo "Blocked: use 'bun' instead of 'yarn'." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE '(^|[;&|] *)pnpm '; then
  echo "Blocked: use 'bun' instead of 'pnpm'." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE '(^|[;&|] *)npx '; then
  echo "Blocked: use 'bunx' instead of 'npx'." >&2
  exit 2
fi

exit 0
