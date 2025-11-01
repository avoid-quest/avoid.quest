import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { Bot, GrammyError, HttpError, InputMediaBuilder } from "grammy";
import { api, getHttpClient } from "../convex/client";
import { createLogger } from "../infra/logger";
import { getEffectiveSettings } from "../settings";

const DEFAULT_SEND_LIMIT = 3;

function getBot(): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return null;
  }
  return new Bot(token);
}

async function sendPost(
  bot: Bot,
  chatId: string,
  post: Doc<"posts">
): Promise<void> {
  const caption = createCaption(post);

  // Load media items for this post
  const mediaItems = await getHttpClient().query(
    api.media_items.getMediaItemsByPostId,
    { postId: post._id }
  );

  const valid = mediaItems
    .filter((m) => m.type === "image" || m.type === "video")
    .map((m) => ({ url: m.url, type: m.type as "image" | "video" }))
    .slice(0, 10);

  try {
    if (valid.length > 1) {
      await sendMediaGroup(bot, chatId, valid, caption);
      return;
    }
    if (await tryPrimaryMedia(bot, chatId, post, caption)) {
      return;
    }
    if (await trySingleValidMedia(bot, chatId, valid, caption)) {
      return;
    }
    await bot.api.sendMessage(chatId, caption, { parse_mode: "HTML" });
  } catch (error) {
    if (error instanceof GrammyError || error instanceof HttpError) {
      throw error;
    }
    throw error as Error;
  }
}

async function sendMediaGroup(
  bot: Bot,
  chatId: string,
  media: Array<{ url: string; type: "image" | "video" }>,
  caption: string
): Promise<void> {
  const mediaGroup = media.map((m, idx) => {
    const cap = idx === media.length - 1 ? caption : undefined;
    return m.type === "video"
      ? InputMediaBuilder.video(m.url, { caption: cap, parse_mode: "HTML" })
      : InputMediaBuilder.photo(m.url, { caption: cap, parse_mode: "HTML" });
  });
  await bot.api.sendMediaGroup(chatId, mediaGroup);
}

async function tryPrimaryMedia(
  bot: Bot,
  chatId: string,
  post: Doc<"posts">,
  caption: string
): Promise<boolean> {
  if (post.media_type === "video" && post.video_url) {
    await bot.api.sendVideo(chatId, post.video_url, {
      caption,
      parse_mode: "HTML",
    });
    return true;
  }
  if (post.media_type === "image" && post.display_url) {
    await bot.api.sendPhoto(chatId, post.display_url, {
      caption,
      parse_mode: "HTML",
    });
    return true;
  }
  return false;
}

async function trySingleValidMedia(
  bot: Bot,
  chatId: string,
  media: Array<{ url: string; type: "image" | "video" }>,
  caption: string
): Promise<boolean> {
  if (media.length !== 1) {
    return false;
  }
  const m = media[0];
  if (!m) {
    return false;
  }
  if (m.type === "video") {
    await bot.api.sendVideo(chatId, m.url, { caption, parse_mode: "HTML" });
  } else {
    await bot.api.sendPhoto(chatId, m.url, { caption, parse_mode: "HTML" });
  }
  return true;
}

export async function runTelegramOnce(): Promise<void> {
  const settings = await getEffectiveSettings();
  const logger = createLogger(
    !!(settings.logging?.active || process.env.DEBUG)
  );
  if (!settings.telegram.active) {
    return;
  }
  const bot = getBot();
  if (!bot) {
    return;
  }

  const chatId =
    settings.telegram.group_chat_id || settings.telegram.admin_chat_id;
  if (!chatId) {
    return;
  }

  const limit = settings.telegram.send_limit ?? DEFAULT_SEND_LIMIT;
  const unsent = await getHttpClient().query(api.posts.getUnsent, { limit });
  logger.info(`Sending ${unsent.length} unsent posts`);

  for (const post of unsent) {
    await sendPost(bot, chatId, post);
    await getHttpClient().mutation(api.posts.markSent, {
      id: post._id,
      sentAt: Date.now(),
    });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkMentions(html: string): string {
  return html.replace(
    /@([a-zA-Z0-9._]+)/g,
    (_match, username: string) =>
      `<a href="https://instagram.com/${username}">@${username}</a>`
  );
}

function createCaption(post: Doc<"posts">): string {
  const maxLen = 1024;
  let caption = post.caption ? escapeHtml(post.caption.trim()) : "";
  if (caption) {
    caption = linkMentions(caption);
  }
  const link = post.url
    ? `\n\n<a href="${post.url}">View on Instagram</a>`
    : "";
  let combined = caption + link;
  if (combined.length > maxLen) {
    if (link) {
      const allowed = Math.max(0, maxLen - link.length);
      combined = caption.slice(0, allowed) + link;
    } else {
      combined = caption.slice(0, maxLen);
    }
  }
  return combined;
}
