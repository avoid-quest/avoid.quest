import type { Id } from "@workspace/backend/convex/_generated/dataModel";
import { api, getHttpClient } from "../../../convex/client";
import { createBot } from "../../bot";
import { sendPost } from "../../post-sender";
import type { AdminContext } from "../types";

const CONVEX_ID_REGEX = /^[a-z0-9]+$/;

export async function handlePreviewCommand(
  ctx: AdminContext,
  postIdStr?: string
): Promise<void> {
  if (!postIdStr) {
    await ctx.reply(
      "❌ Please provide a post ID\n\nUsage: /preview <post_id>",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Validate post ID format (Convex IDs are strings)
  if (typeof postIdStr !== "string" || postIdStr.length < 1) {
    await ctx.reply("❌ Invalid post ID format", { parse_mode: "HTML" });
    return;
  }

  try {
    // Validate post ID is a valid Convex ID format
    if (!CONVEX_ID_REGEX.test(postIdStr)) {
      await ctx.reply("❌ Invalid post ID format", { parse_mode: "HTML" });
      return;
    }

    const post = await getHttpClient().query(api.posts.getPostById, {
      id: postIdStr as Id<"posts">,
    });

    if (!post) {
      await ctx.reply(`❌ Post not found: ${postIdStr}`, {
        parse_mode: "HTML",
      });
      return;
    }

    await ctx.reply("⏳ Sending preview...", { parse_mode: "HTML" });

    const bot = createBot();
    if (!bot) {
      await ctx.reply("❌ Bot not available", { parse_mode: "HTML" });
      return;
    }

    const adminChatId = ctx.adminChatId;
    if (!adminChatId) {
      await ctx.reply("❌ Admin chat ID not available", { parse_mode: "HTML" });
      return;
    }

    // Send post using sendPost (this will NOT mark it as sent in DB)
    // We're calling sendPost directly, which doesn't call markSent
    await sendPost(bot, adminChatId, post, ctx.logger);

    await ctx.reply(
      "✅ Preview sent! (Note: This was a preview and was NOT marked as sent in the database)",
      { parse_mode: "HTML" }
    );
  } catch (error) {
    ctx.logger.error(
      `Error in handlePreviewCommand: ${error instanceof Error ? error.message : String(error)}`
    );
    await ctx.reply(
      `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      { parse_mode: "HTML" }
    );
  }
}
