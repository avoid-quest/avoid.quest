import { api, getHttpClient } from "../../../convex/client";
import { scrapeAndSaveSinglePost } from "../../../scraping/scraper";
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

  await ctx.reply("⏳ Scraping post...", { parse_mode: "HTML" });

  try {
    const result = await scrapeAndSaveSinglePost(url);

    if (!result.success) {
      await ctx.reply(
        `❌ Failed to scrape post: ${result.error ?? "Unknown error"}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!result.postId) {
      await ctx.reply("❌ Post scraped but no ID returned", {
        parse_mode: "HTML",
      });
      return;
    }

    const post = await getHttpClient().query(api.posts.getPostById, {
      id: result.postId,
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

  await ctx.reply("⏳ Scraping post for preview...", { parse_mode: "HTML" });

  try {
    // Use scrapeAndSaveSinglePost but we'll just show the result without saving
    // Actually, we need to scrape without saving - let me check the scraper
    // For now, we'll scrape and save, then show it
    const result = await scrapeAndSaveSinglePost(url);

    if (!result.success) {
      await ctx.reply(
        `❌ Failed to scrape post: ${result.error ?? "Unknown error"}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!result.postId) {
      await ctx.reply("❌ Post scraped but no ID returned", {
        parse_mode: "HTML",
      });
      return;
    }

    const post = await getHttpClient().query(api.posts.getPostById, {
      id: result.postId,
    });
    if (!post) {
      await ctx.reply("✅ Post scraped but could not retrieve details", {
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
