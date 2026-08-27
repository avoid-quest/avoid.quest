import type { RadioMetadataResponse } from "./types";

type MetadataDecodeResult =
  | { kind: "metadata"; response: Extract<RadioMetadataResponse, { ok: true }> }
  | {
      kind: "unsupported";
      response: Extract<RadioMetadataResponse, { ok: false }>;
    }
  | { kind: "failure"; message: string };

const RADIO_METADATA_ERROR_CODES = new Set([
  "RADIO_METADATA_URL_REQUIRED",
  "RADIO_METADATA_INVALID_URL",
  "RADIO_METADATA_INTERNAL_ADDRESS",
  "RADIO_METADATA_HOSTNAME_RESOLUTION_FAILED",
  "RADIO_METADATA_UNSUPPORTED",
  "RADIO_METADATA_TIMEOUT",
  "RADIO_METADATA_UPSTREAM_ERROR",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getProblemMessage(data: unknown, fallback: string): string {
  if (!isRecord(data)) {
    return fallback;
  }
  for (const key of ["safeMessage", "message", "title", "detail"]) {
    const value = data[key];
    if (isNonEmptyString(value)) {
      return value;
    }
  }
  const { error } = data;
  if (isRecord(error)) {
    const { message } = error;
    if (isNonEmptyString(message)) {
      return message;
    }
  }
  return fallback;
}

export function decodeRadioMetadataResponse(
  response: Response,
  data: unknown
): MetadataDecodeResult {
  if (isRecord(data) && data.ok === true && isRecord(data.data)) {
    return {
      kind: "metadata",
      response: data as Extract<RadioMetadataResponse, { ok: true }>,
    };
  }

  if (isRecord(data) && data.ok === false && isRecord(data.error)) {
    const { code, message } = data.error;
    if (typeof code === "string" && RADIO_METADATA_ERROR_CODES.has(code)) {
      const decoded = data as Extract<RadioMetadataResponse, { ok: false }>;
      if (code === "RADIO_METADATA_UNSUPPORTED") {
        return { kind: "unsupported", response: decoded };
      }
      return {
        kind: "failure",
        message: isNonEmptyString(message)
          ? message
          : "Failed to load radio metadata",
      };
    }
  }

  return {
    kind: "failure",
    message: getProblemMessage(
      data,
      response.ok
        ? "Invalid radio metadata response"
        : "Failed to load radio metadata"
    ),
  };
}
