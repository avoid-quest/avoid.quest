import type { RadioMetadataResponse } from "./types";

type MetadataDecodeResult =
  | { kind: "metadata"; response: Extract<RadioMetadataResponse, { ok: true }> }
  | {
      kind: "unsupported";
      response: Extract<RadioMetadataResponse, { ok: false }>;
    }
  | { kind: "failure"; message: string };

const ERROR_CODES = new Set([
  "RADIO_METADATA_URL_REQUIRED",
  "RADIO_METADATA_INVALID_URL",
  "RADIO_METADATA_INTERNAL_ADDRESS",
  "RADIO_METADATA_UNSUPPORTED",
  "RADIO_METADATA_TIMEOUT",
  "RADIO_METADATA_UPSTREAM_ERROR",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProblemMessage(data: unknown, fallback: string): string {
  if (!isRecord(data)) {
    return fallback;
  }
  for (const key of ["safeMessage", "message", "title", "detail"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  const error = data.error;
  if (isRecord(error)) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
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
    const code = data.error.code;
    const message = data.error.message;
    if (typeof code === "string" && ERROR_CODES.has(code)) {
      const decoded = data as Extract<RadioMetadataResponse, { ok: false }>;
      return code === "RADIO_METADATA_UNSUPPORTED"
        ? { kind: "unsupported", response: decoded }
        : {
            kind: "failure",
            message:
              typeof message === "string" && message.trim()
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
