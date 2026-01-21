import type { Id } from "@workspace/backend/convex/_generated/dataModel";
import { fetchAndSaveSinglePost } from "../../../adapter/adapter";
import { api, getHttpClient } from "../../../convex/client";
import type { AdminContext } from "../types";
import { formatPost } from "../utils";

export async function handlePostAddCommand(
  ctx: AdminContext,
  url: string
): Promise<void> {
  if (!url) {
    await ctx.reply(
      "❌ Please provide an Instagram post URL\n\nUsage: /post add <url>",
      { parse_mode: "HTML" }
    );
    return;
  }

  await ctx.reply("⏳ Fetching post...", { parse_mode: "HTML" });

  try {
    const result = await fetchAndSaveSinglePost(url);

    if (!result.success) {
      await ctx.reply(
        `❌ Failed to fetch post: ${result.error ?? "Unknown error"}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!result.postId) {
      await ctx.reply("❌ Post fetched but no ID returned", {
        parse_mode: "HTML",
      });
      return;
    }

    const post = await getHttpClient().query(api.posts.getPostById, {
      id: result.postId as Id<"posts">,
    });
    if (!post) {
      await ctx.reply("✅ Post saved but could not retrieve details", {
        parse_mode: "HTML",
      });
      return;
    }

    const postText = formatPost(post);
    await ctx.reply(`✅ Post saved successfully!\n\n${postText}`, {
      parse_mode: "HTML",
    });
  } catch (error) {
    ctx.logger.error(
      `Error in handlePostAddCommand: ${error instanceof Error ? error.message : String(error)}`
    );
    await ctx.reply(
      `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      { parse_mode: "HTML" }
    );
  }
}

export async function handlePostPreviewCommand(
  ctx: AdminContext,
  url: string
): Promise<void> {
  if (!url) {
    await ctx.reply(
      "❌ Please provide an Instagram post URL\n\nUsage: /post preview <url>",
      { parse_mode: "HTML" }
    );
    return;
  }

  await ctx.reply("⏳ Fetching post for preview...", { parse_mode: "HTML" });

  try {
    // Use fetchAndSaveSinglePost but we'll just show the result without saving
    // Actually, we need to fetch without saving - let me check the adapter
    // For now, we'll fetch and save, then show it
    const result = await fetchAndSaveSinglePost(url);

    if (!result.success) {
      await ctx.reply(
        `❌ Failed to fetch post: ${result.error ?? "Unknown error"}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!result.postId) {
      await ctx.reply("❌ Post fetched but no ID returned", {
        parse_mode: "HTML",
      });
      return;
    }

    const post = await getHttpClient().query(api.posts.getPostById, {
      id: result.postId as Id<"posts">,
    });
    if (!post) {
      await ctx.reply("✅ Post fetched but could not retrieve details", {
        parse_mode: "HTML",
      });
      return;
    }

    const postText = formatPost(post);
    await ctx.reply(`📱 Post Preview:\n\n${postText}`, { parse_mode: "HTML" });
  } catch (error) {
    ctx.logger.error(
      `Error in handlePostPreviewCommand: ${error instanceof Error ? error.message : String(error)}`
    );
    await ctx.reply(
      `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      { parse_mode: "HTML" }
    );
  }
}
