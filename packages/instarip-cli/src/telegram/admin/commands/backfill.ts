import type { Message, PhotoSize, Video } from "grammy/types";
import { api, getHttpClient } from "../../../convex/client";
import type { TelegramMediaItem } from "../../types";
import type { AdminContext } from "../types";

/**
 * Extract Instagram shortcode from caption text
 * Matches: instagram.com/p/SHORTCODE or instagram.com/reel/SHORTCODE
 */
function extractShortcodeFromCaption(caption: string): string | null {
  const match = caption.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

/**
 * Extract file_ids from a Telegram message
 */
function extractFileIdsFromMessage(message: Message): TelegramMediaItem[] {
  const items: TelegramMediaItem[] = [];

  // Handle photo (array of sizes, use largest)
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.at(-1) as PhotoSize;
    items.push({
      file_id: largest.file_id,
      file_unique_id: largest.file_unique_id,
      type: "image",
      width: largest.width,
      height: largest.height,
    });
  }

  // Handle video
  if (message.video) {
    const video = message.video as Video;
    items.push({
      file_id: video.file_id,
      file_unique_id: video.file_unique_id,
      type: "video",
      width: video.width,
      height: video.height,
    });
  }

  return items;
}

/**
 * Handle /backfill_status command - show backfill statistics
 */
export async function handleBackfillStatusCommand(
  ctx: AdminContext
): Promise<void> {
  try {
    const stats = await getHttpClient().query(api.posts.getBackfillStats, {});

    const statusText =
      "<b>📊 Backfill Status</b>\n\n" +
      `✅ With file_ids: <b>${stats.withFileIds}</b>\n` +
      `❌ Needs backfill: <b>${stats.needsBackfill}</b>\n` +
      `📝 Total sent: <b>${stats.totalSent}</b>\n\n` +
      "<i>To backfill, forward messages from the channel to this chat.</i>";

    await ctx.reply(statusText, { parse_mode: "HTML" });
  } catch (error) {
    ctx.logger.error(
      `Failed to get backfill stats: ${error instanceof Error ? error.message : String(error)}`
    );
    await ctx.reply("❌ Failed to get backfill statistics", {
      parse_mode: "HTML",
    });
  }
}

/**
 * Handle forwarded messages for backfill
 * Extracts file_ids from forwarded media and updates Convex
 */
export async function handleForwardedMessage(ctx: AdminContext): Promise<void> {
  const message = ctx.message;
  if (!message) {
    return;
  }

  // Get caption from message (could be on photo/video or standalone)
  const caption = message.caption || message.text || "";

  // Extract shortcode from caption
  const shortcode = extractShortcodeFromCaption(caption);
  if (!shortcode) {
    await ctx.reply(
      "❌ Could not find Instagram shortcode in this message.\n" +
        "<i>Messages must contain an instagram.com/p/... or instagram.com/reel/... link.</i>",
      { parse_mode: "HTML" }
    );
    return;
  }

  ctx.logger.debug(`Extracted shortcode: ${shortcode}`);

  // Find matching post in Convex
  const post = await getHttpClient().query(api.posts.getPostByShortcode, {
    shortcode,
  });

  if (!post) {
    await ctx.reply(
      `❌ No post found with shortcode: <code>${shortcode}</code>`,
      {
        parse_mode: "HTML",
      }
    );
    return;
  }

  // Extract file_ids from forwarded message
  const mediaItems = extractFileIdsFromMessage(message);

  if (mediaItems.length === 0) {
    await ctx.reply(
      `⚠️ No media found in this message for shortcode: <code>${shortcode}</code>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  ctx.logger.debug(
    `Found ${mediaItems.length} media items for post ${post._id}`
  );

  // Update Convex with file_ids
  try {
    await getHttpClient().mutation(
      api.media_items.syncTelegramMediaItemsForPost,
      {
        post_id: post._id,
        media_items: mediaItems,
      }
    );

    const mediaTypes = mediaItems.map((m) => m.type).join(", ");
    await ctx.reply(
      `✅ Backfilled <b>${mediaItems.length}</b> media item(s) for post <code>${shortcode}</code>\n` +
        `<i>Types: ${mediaTypes}</i>`,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    ctx.logger.error(
      `Failed to sync media items: ${error instanceof Error ? error.message : String(error)}`
    );
    await ctx.reply(
      `❌ Failed to update media items for shortcode: <code>${shortcode}</code>`,
      { parse_mode: "HTML" }
    );
  }
}

/**
 * Check if a message is a forwarded message (has forward origin)
 */
export function isForwardedMessage(message: Message | undefined): boolean {
  if (!message) {
    return false;
  }
  // Check for forward_origin (Bot API 7.0+)
  return !!message.forward_origin;
}
