import type { MediaItem, MediaLogger, UrlValidationResult } from "./types";

const HTTP_TIMEOUT_MS = 5000;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_NOT_FOUND = 404;
const RETRY_BACKOFF_BASE_MS = 100;

function getRequestMethod(url: string): "GET" | "HEAD" {
  // Use GET for Instagram URLs as some don't support HEAD
  if (url.includes("cdninstagram.com") || url.includes("fbcdn.net")) {
    return "GET";
  }
  return "HEAD";
}

function isPermanentError(status: number): boolean {
  return status === HTTP_STATUS_FORBIDDEN || status === HTTP_STATUS_NOT_FOUND;
}

function isTransientNetworkError(errorMsg: string): boolean {
  return (
    errorMsg.includes("timeout") ||
    errorMsg.includes("network") ||
    errorMsg.includes("ECONNREFUSED") ||
    errorMsg.includes("ETIMEDOUT")
  );
}

async function waitForRetry(attempt: number): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, RETRY_BACKOFF_BASE_MS * (attempt + 1))
  );
}

async function attemptUrlValidation(
  item: MediaItem,
  index: number,
  logger: MediaLogger
): Promise<{ success: boolean; error: string | null; isPermanent: boolean }> {
  try {
    const method = getRequestMethod(item.url);
    const response = await fetch(item.url, {
      method,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TelegramBot/1.0)",
      },
    });

    if (response.ok) {
      const contentType = response.headers.get("content-type");
      if (contentType) {
        logger.debug(
          `Media item ${index} (${item.type}): Content-Type: ${contentType}`
        );
      }
      return { success: true, error: null, isPermanent: false };
    }

    const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
    const isPermanent = isPermanentError(response.status);

    if (response.status === HTTP_STATUS_FORBIDDEN) {
      return {
        success: false,
        error: `${errorMsg} - URL may be expired or blocked`,
        isPermanent: true,
      };
    }

    if (response.status === HTTP_STATUS_NOT_FOUND) {
      return {
        success: false,
        error: `${errorMsg} - URL not found`,
        isPermanent: true,
      };
    }

    return { success: false, error: errorMsg, isPermanent };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isPermanent = !isTransientNetworkError(errorMsg);

    if (errorMsg.includes("Malformed_HTTP_Response")) {
      return {
        success: false,
        error: `${errorMsg} - URL may be expired or server error`,
        isPermanent: true,
      };
    }

    return { success: false, error: errorMsg, isPermanent };
  }
}

async function validateSingleMediaUrl(
  item: MediaItem,
  index: number,
  logger: MediaLogger,
  retries: number
): Promise<{ success: boolean; error: string | null }> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await attemptUrlValidation(item, index, logger);

    if (result.success) {
      return { success: true, error: null };
    }

    lastError = result.error;

    if (result.isPermanent) {
      return { success: false, error: result.error };
    }

    if (attempt < retries) {
      await waitForRetry(attempt);
      continue;
    }

    return { success: false, error: result.error };
  }

  return {
    success: false,
    error: `Max retries exceeded for ${item.url}: ${lastError ?? "unknown error"}`,
  };
}

/**
 * Validate media URLs for accessibility with retry logic
 */
export async function validateMediaUrls(
  media: MediaItem[],
  logger: MediaLogger,
  retries = 1
): Promise<UrlValidationResult> {
  const inaccessible: Array<{ index: number; url: string; error: string }> = [];
  let accessible = 0;

  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    if (!item) {
      continue;
    }

    const result = await validateSingleMediaUrl(item, i, logger, retries);
    if (result.success) {
      accessible += 1;
    } else if (result.error) {
      inaccessible.push({
        index: i,
        url: item.url,
        error: result.error,
      });
    }
  }

  return { accessible, inaccessible };
}
