import { InputMediaBuilder } from "grammy";
import type { InputMediaPhoto, InputMediaVideo } from "grammy/types";
import type { MediaItem, TelegramMediaItem } from "./types";

/**
 * Build InputMedia array for media group (URL-based)
 * Caption is added to the last item in the group
 * @deprecated Use buildTelegramMediaGroup for file_id-based media
 */
export function buildMediaGroup(
  mediaItems: MediaItem[],
  caption: string
): Array<InputMediaPhoto | InputMediaVideo> {
  return mediaItems.map((item, index) => {
    const isLast = index === mediaItems.length - 1;
    const mediaCaption = isLast ? caption : undefined;

    if (item.type === "video") {
      return InputMediaBuilder.video(item.url, {
        caption: mediaCaption,
        parse_mode: "HTML",
      });
    }
    return InputMediaBuilder.photo(item.url, {
      caption: mediaCaption,
      parse_mode: "HTML",
    });
  });
}

/**
 * Build a single InputMedia item (URL-based)
 * @deprecated Use buildTelegramMediaItem for file_id-based media
 */
export function buildMediaItem(
  item: MediaItem,
  caption?: string
): InputMediaPhoto | InputMediaVideo {
  if (item.type === "video") {
    return InputMediaBuilder.video(item.url, {
      caption,
      parse_mode: "HTML",
    });
  }
  return InputMediaBuilder.photo(item.url, {
    caption,
    parse_mode: "HTML",
  });
}

/**
 * Build InputMedia array for media group using Telegram file_ids
 * Caption is added to the last item in the group
 * file_ids never expire and are the preferred method
 */
export function buildTelegramMediaGroup(
  mediaItems: TelegramMediaItem[],
  caption: string
): Array<InputMediaPhoto | InputMediaVideo> {
  return mediaItems.map((item, index) => {
    const isLast = index === mediaItems.length - 1;
    const mediaCaption = isLast ? caption : undefined;

    if (item.type === "video") {
      return InputMediaBuilder.video(item.file_id, {
        caption: mediaCaption,
        parse_mode: "HTML",
      });
    }
    return InputMediaBuilder.photo(item.file_id, {
      caption: mediaCaption,
      parse_mode: "HTML",
    });
  });
}

/**
 * Build a single InputMedia item using Telegram file_id
 * file_ids never expire and are the preferred method
 */
export function buildTelegramMediaItem(
  item: TelegramMediaItem,
  caption?: string
): InputMediaPhoto | InputMediaVideo {
  if (item.type === "video") {
    return InputMediaBuilder.video(item.file_id, {
      caption,
      parse_mode: "HTML",
    });
  }
  return InputMediaBuilder.photo(item.file_id, {
    caption,
    parse_mode: "HTML",
  });
}
