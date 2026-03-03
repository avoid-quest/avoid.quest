#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if echo "$COMMAND" | grep -qiE '(^|[;&|] *)(wrangler|convex) deploy'; then
  echo "Blocked: deployment commands are not allowed. Deploy manually." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'bun run (cf-deploy|deploy)'; then
  echo "Blocked: deployment commands are not allowed. Deploy manually." >&2
  exit 2
fi

exit 0
