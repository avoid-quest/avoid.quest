export type Html5LoadMode = "cors-anonymous" | "no-cors";

const LOAD_MODE_STORAGE_KEY = "radio-app-html5-load-modes";
const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

type LoadModeRecord = Record<string, Html5LoadMode>;

export type LoadModeCache = {
  get: (streamUrl: string) => Html5LoadMode | null;
  set: (streamUrl: string, mode: Html5LoadMode) => void;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isLoadMode(value: unknown): value is Html5LoadMode {
  return value === "cors-anonymous" || value === "no-cors";
}

function getStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRecord(storage: StorageLike | null): LoadModeRecord {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(LOAD_MODE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const valid: LoadModeRecord = {};
    for (const [url, mode] of Object.entries(parsed)) {
      if (isLoadMode(mode)) {
        valid[url] = mode;
      }
    }
    return valid;
  } catch {
    return {};
  }
}

function writeRecord(
  storage: StorageLike | null,
  record: LoadModeRecord
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(LOAD_MODE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore storage write failures
  }
}

export function createLoadModeCache(storage = getStorage()): LoadModeCache {
  return {
    get(streamUrl) {
      const record = readRecord(storage);
      return record[streamUrl] ?? null;
    },
    set(streamUrl, mode) {
      const record = readRecord(storage);
      record[streamUrl] = mode;
      writeRecord(storage, record);
    },
  };
}

export function getInitialLoadMode(
  cachedMode: Html5LoadMode | null
): Html5LoadMode {
  return cachedMode ?? "cors-anonymous";
}

export function getRetryLoadMode(
  initialMode: Html5LoadMode,
  shouldRetry: boolean
): Html5LoadMode | null {
  if (!shouldRetry) {
    return null;
  }
  if (initialMode === "cors-anonymous") {
    return "no-cors";
  }
  return null;
}

export function shouldRetryWithoutCors(
  error: unknown,
  mediaErrorCode?: number | null
): boolean {
  if (mediaErrorCode === MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return true;
  }

  if (error instanceof DOMException && error.name === "NotSupportedError") {
    return true;
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  return (
    message.includes("no supported source") ||
    message.includes("not supported") ||
    message.includes("media source") ||
    message.includes("cors") ||
    message.includes("cross-origin") ||
    message.includes("err_failed")
  );
}

export function mapPlaybackFailureMessage(
  error: unknown,
  mediaErrorCode?: number | null
): string {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "");
  const normalizedMessage = rawMessage.trim().toLowerCase();

  if (mediaErrorCode === MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return "Unsupported stream format for this browser";
  }

  if (mediaErrorCode === MEDIA_ERR_NETWORK) {
    return "Network error while loading stream";
  }

  if (mediaErrorCode === MEDIA_ERR_DECODE) {
    return "Stream decode error";
  }

  if (mediaErrorCode === MEDIA_ERR_ABORTED) {
    return "Stream loading was interrupted";
  }

  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Playback blocked by browser policy";
  }

  if (error instanceof DOMException && error.name === "SecurityError") {
    return "Playback blocked by browser security policy";
  }

  if (error instanceof DOMException && error.name === "NotSupportedError") {
    return "Unsupported stream format for this browser";
  }

  if (
    normalizedMessage.includes("403") ||
    normalizedMessage.includes("404") ||
    normalizedMessage.includes("forbidden") ||
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("station config not found")
  ) {
    return "Stream endpoint unavailable";
  }

  if (normalizedMessage.includes("network")) {
    return "Network error while loading stream";
  }

  if (rawMessage.trim() !== "") {
    return rawMessage;
  }

  return "Playback failed";
}
