#!/bin/bash
# Wipe all instarip post data from Convex and Telegram CDN chat
#
# Usage: ./scripts/wipe-instarip-data.sh [--confirm] [--skip-telegram]

set -e

BACKEND_DIR="packages/backend"
TELEGRAM_CDN_CHAT_ID="${TELEGRAM_CDN_CHAT_ID:--1002738016638}"

CONFIRM=false
SKIP_TELEGRAM=false

for arg in "$@"; do
  case $arg in
    --confirm)
      CONFIRM=true
      ;;
    --skip-telegram)
      SKIP_TELEGRAM=true
      ;;
  esac
done

echo "🗑️  Instarip Data Wipe Script"
echo "============================"
echo ""

cd "$BACKEND_DIR"

# Step 1: Check what would be deleted
echo "📊 Checking data to be deleted..."
echo ""

bunx convex run --component instarip admin:wipePostData '{"confirm": false}' 2>/dev/null

echo ""

if [ "$CONFIRM" = false ]; then
  echo "⚠️  DRY RUN - No data deleted"
  echo "   Run with --confirm to actually delete data"
  exit 0
fi

# Step 2: Get Telegram message IDs before wiping (if not skipping)
if [ "$SKIP_TELEGRAM" = false ]; then
  echo "📱 Getting Telegram message IDs..."
  TELEGRAM_MESSAGES=$(bunx convex run --component instarip admin:getTelegramMessageIds "{\"chatId\": \"$TELEGRAM_CDN_CHAT_ID\"}" 2>/dev/null)
  MSG_COUNT=$(echo "$TELEGRAM_MESSAGES" | jq 'length')
  echo "   Found $MSG_COUNT messages to delete from Telegram"
  echo ""
fi

# Step 3: Wipe Convex data
echo "🗄️  Wiping Convex data..."
bunx convex run --component instarip admin:wipePostData '{"confirm": true}' 2>/dev/null
echo ""

# Step 4: Delete Telegram messages
if [ "$SKIP_TELEGRAM" = false ] && [ "$MSG_COUNT" -gt 0 ]; then
  echo "📱 Deleting Telegram messages..."
  echo "   This may take a while..."
  echo ""
  
  # Get bot token from Convex env
  BOT_TOKEN=$(bunx convex env get TELEGRAM_BOT_TOKEN 2>/dev/null)
  
  if [ -z "$BOT_TOKEN" ]; then
    echo "⚠️  TELEGRAM_BOT_TOKEN not found in Convex env"
    echo "   Delete messages manually from chat $TELEGRAM_CDN_CHAT_ID"
  else
    # Extract message IDs and delete in batches
    MESSAGE_IDS=$(echo "$TELEGRAM_MESSAGES" | jq '[.[].messageId]')
    
    bunx convex run --component telegram admin:deleteMessages "{
      \"botToken\": \"$BOT_TOKEN\",
      \"chatId\": \"$TELEGRAM_CDN_CHAT_ID\",
      \"messageIds\": $MESSAGE_IDS,
      \"delayMs\": 50
    }" 2>/dev/null
  fi
fi

echo ""
echo "✨ Wipe complete!"
