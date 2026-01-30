#!/usr/bin/env bun
/**
 * Wipe all instarip post data from Convex and Telegram CDN chat
 *
 * Usage: bun scripts/wipe-instarip-data.ts [--confirm] [--skip-telegram]
 *
 * Options:
 *   --confirm       Actually delete data (dry run without this)
 *   --skip-telegram Skip Telegram message deletion
 */

import { ConvexHttpClient } from "convex/browser";
import { api, components } from "../packages/backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://different-mallard-621.convex.cloud";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CDN_CHAT_ID = process.env.TELEGRAM_CDN_CHAT_ID || "-1002738016638";

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const skipTelegram = args.includes("--skip-telegram");

async function main() {
  console.log("🗑️  Instarip Data Wipe Script");
  console.log("============================\n");

  const client = new ConvexHttpClient(CONVEX_URL);

  // Step 1: Check what would be deleted
  console.log("📊 Checking data to be deleted...\n");

  const previewResult = await client.mutation(
    components.instarip.admin.wipePostData,
    { confirm: false }
  );

  if ("wouldDelete" in previewResult) {
    const { wouldDelete } = previewResult;
    console.log(`  Posts:            ${wouldDelete.posts}`);
    console.log(`  Media Items:      ${wouldDelete.mediaItems}`);
    console.log(`  Telegram Messages: ${wouldDelete.telegramMessages}`);
    console.log(`  Fetch Logs:       ${wouldDelete.fetchLogs}`);
    console.log("");
  }

  if (!confirm) {
    console.log("⚠️  DRY RUN - No data deleted");
    console.log("   Run with --confirm to actually delete data");
    return;
  }

  // Step 2: Get Telegram message IDs before wiping Convex
  let telegramMessageIds: { messageId: number; chatId: string }[] = [];

  if (!skipTelegram) {
    console.log("📱 Getting Telegram message IDs...");
    telegramMessageIds = await client.mutation(
      components.instarip.admin.getTelegramMessageIds,
      { chatId: TELEGRAM_CDN_CHAT_ID }
    );
    console.log(`   Found ${telegramMessageIds.length} messages to delete from Telegram\n`);
  }

  // Step 3: Wipe Convex data
  console.log("🗄️  Wiping Convex data...");
  const wipeResult = await client.mutation(
    components.instarip.admin.wipePostData,
    { confirm: true }
  );

  if ("deleted" in wipeResult) {
    console.log(`   ✅ Deleted ${wipeResult.deleted.posts} posts`);
    console.log(`   ✅ Deleted ${wipeResult.deleted.mediaItems} media items`);
    console.log(`   ✅ Deleted ${wipeResult.deleted.telegramMessages} telegram message records`);
    console.log(`   ✅ Deleted ${wipeResult.deleted.fetchLogs} fetch logs\n`);
  }

  // Step 4: Delete Telegram messages
  if (!skipTelegram && telegramMessageIds.length > 0) {
    if (!TELEGRAM_BOT_TOKEN) {
      console.log("⚠️  TELEGRAM_BOT_TOKEN not set, skipping Telegram message deletion");
      console.log("   Set the env var or delete messages manually from chat " + TELEGRAM_CDN_CHAT_ID);
      return;
    }

    console.log("📱 Deleting Telegram messages...");
    console.log("   This may take a while...\n");

    const messageIds = telegramMessageIds.map((m) => m.messageId);

    // Process in batches of 50
    const batchSize = 50;
    let totalDeleted = 0;
    let totalFailed = 0;

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const progress = Math.round(((i + batch.length) / messageIds.length) * 100);

      const result = await client.action(
        components.telegram.admin.deleteMessages,
        {
          botToken: TELEGRAM_BOT_TOKEN,
          chatId: TELEGRAM_CDN_CHAT_ID,
          messageIds: batch,
          delayMs: 50,
        }
      );

      totalDeleted += result.deleted;
      totalFailed += result.failed;

      console.log(`   [${progress}%] Deleted: ${totalDeleted}, Failed: ${totalFailed}`);
    }

    console.log(`\n   ✅ Telegram cleanup complete`);
    console.log(`      Deleted: ${totalDeleted}, Failed: ${totalFailed}`);
  }

  console.log("\n✨ Wipe complete!");
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
