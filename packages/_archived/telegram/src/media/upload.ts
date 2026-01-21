import type { Api, RawApi } from "grammy";
import { InputFile } from "grammy";
import type { MediaLogger } from "./types";

/**
 * Result of uploading media to Telegram
 */
export type UploadResult = {
  file_id: string;
  file_unique_id: string;
  type: "image" | "video";
  width?: number;
  height?: number;
};

/**
 * Item to upload to Telegram
 */
export type MediaUploadItem = {
  source: string | Buffer;
  type: "image" | "video";
};

/**
 * Options for creating a media upload service
 */
export type MediaUploadServiceOptions = {
  /**
   * Whether to delete the uploaded message after extracting file_id
   * Useful when using a separate storage channel
   */
  deleteAfterUpload?: boolean;
  /**
   * Delay in ms between individual uploads to respect rate limits
   * Default: 500ms
   */
  uploadDelayMs?: number;
  /**
   * Optional delay in ms after completing a batch upload
   * Useful for rate limit management when uploading multiple batches
   */
  delayAfterBatchMs?: number;
  /**
   * Logger for debug output
   */
  logger?: MediaLogger;
};

/**
 * Delay between individual uploads to respect Telegram rate limits.
 * 500ms provides a safe margin under Telegram's 30 messages/second limit
 * while maintaining reasonable upload speeds for media groups.
 */
const DEFAULT_UPLOAD_DELAY_MS = 500;

/**
 * Service for uploading media to Telegram and extracting file_ids
 */
export type MediaUploadService = {
  /**
   * Upload a photo and get its file_id
   */
  uploadPhoto(chatId: string, source: string | Buffer): Promise<UploadResult>;

  /**
   * Upload a video and get its file_id
   */
  uploadVideo(chatId: string, source: string | Buffer): Promise<UploadResult>;

  /**
   * Upload multiple media items
   */
  uploadMediaItems(
    chatId: string,
    items: MediaUploadItem[]
  ): Promise<UploadResult[]>;
};

/**
 * Create a media upload service using a Telegram bot API
 */
export function createMediaUploadService(
  api: Api<RawApi>,
  options: MediaUploadServiceOptions = {}
): MediaUploadService {
  const {
    deleteAfterUpload = false,
    uploadDelayMs = DEFAULT_UPLOAD_DELAY_MS,
    delayAfterBatchMs,
    logger,
  } = options;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function uploadPhoto(
    chatId: string,
    source: string | Buffer
  ): Promise<UploadResult> {
    logger?.debug(`Uploading photo to chat ${chatId}`);

    const inputFile =
      typeof source === "string" ? source : new InputFile(source);

    const message = await api
      .sendPhoto(chatId, inputFile, {
        disable_notification: true,
      })
      .catch((error: unknown) => {
        const sourceDesc =
          typeof source === "string" ? source.slice(0, 100) : "[Buffer]";
        throw new Error(
          `Failed to upload photo to chat ${chatId} (source: ${sourceDesc}): ${error instanceof Error ? error.message : String(error)}`
        );
      });

    // Get the largest photo size (last in array)
    const photo = message.photo;
    if (!photo || photo.length === 0) {
      throw new Error("No photo in response after upload");
    }

    const largest = photo.at(-1);
    if (!largest) {
      throw new Error("Could not get largest photo size");
    }

    // Optionally delete the message after extracting file_id
    if (deleteAfterUpload) {
      try {
        await api.deleteMessage(chatId, message.message_id);
        logger?.debug(`Deleted temporary upload message ${message.message_id}`);
      } catch (error) {
        logger?.warn(
          `Failed to delete temporary upload message: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    logger?.debug(`Photo uploaded: file_id=${largest.file_id.slice(0, 20)}...`);

    return {
      file_id: largest.file_id,
      file_unique_id: largest.file_unique_id,
      type: "image",
      width: largest.width,
      height: largest.height,
    };
  }

  async function uploadVideo(
    chatId: string,
    source: string | Buffer
  ): Promise<UploadResult> {
    logger?.debug(`Uploading video to chat ${chatId}`);

    const inputFile =
      typeof source === "string" ? source : new InputFile(source);

    const message = await api
      .sendVideo(chatId, inputFile, {
        disable_notification: true,
      })
      .catch((error: unknown) => {
        const sourceDesc =
          typeof source === "string" ? source.slice(0, 100) : "[Buffer]";
        throw new Error(
          `Failed to upload video to chat ${chatId} (source: ${sourceDesc}): ${error instanceof Error ? error.message : String(error)}`
        );
      });

    const video = message.video;
    if (!video) {
      throw new Error("No video in response after upload");
    }

    // Optionally delete the message after extracting file_id
    if (deleteAfterUpload) {
      try {
        await api.deleteMessage(chatId, message.message_id);
        logger?.debug(`Deleted temporary upload message ${message.message_id}`);
      } catch (error) {
        logger?.warn(
          `Failed to delete temporary upload message: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    logger?.debug(`Video uploaded: file_id=${video.file_id.slice(0, 20)}...`);

    return {
      file_id: video.file_id,
      file_unique_id: video.file_unique_id,
      type: "video",
      width: video.width,
      height: video.height,
    };
  }

  async function uploadMediaItems(
    chatId: string,
    items: MediaUploadItem[]
  ): Promise<UploadResult[]> {
    // Input validation
    if (items.length === 0) {
      throw new Error("Cannot upload empty media items array");
    }

    for (const [index, item] of items.entries()) {
      if (item.type !== "image" && item.type !== "video") {
        throw new Error(`Invalid media type at index ${index}: ${item.type}`);
      }
    }

    const results: UploadResult[] = [];

    for (const [index, item] of items.entries()) {
      if (item.type === "video") {
        results.push(await uploadVideo(chatId, item.source));
      } else {
        results.push(await uploadPhoto(chatId, item.source));
      }

      // Add delay between uploads to respect rate limits (except after last item)
      if (index < items.length - 1) {
        await sleep(uploadDelayMs);
      }
    }

    // Optional delay after completing the batch (useful for rate limit management)
    if (delayAfterBatchMs) {
      await sleep(delayAfterBatchMs);
    }

    return results;
  }

  return {
    uploadPhoto,
    uploadVideo,
    uploadMediaItems,
  };
}
