import { InputMediaBuilder } from "grammy";
import type { InputMediaPhoto, InputMediaVideo } from "grammy/types";
import type { MediaItem } from "./types";

/**
 * Build InputMedia array for media group
 * Caption is added to the last item in the group
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
 * Build a single InputMedia item
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
