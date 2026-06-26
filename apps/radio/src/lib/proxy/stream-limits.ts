const BYTE_RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;
const CONTENT_LENGTH_PATTERN = /^\d+$/;

export type BoundedRangeResult =
  | { ok: true; range: string | null }
  | { ok: false; reason: "invalid-range" };

export type ContentLengthLimitFailure = "invalid" | "too-large";

export type StreamLimitReason = "bytes" | "duration";

type LimitResponseBodyOptions = {
  abortController?: AbortController;
  maxBytes: number;
  maxDurationMs: number;
  onLimitExceeded?: (reason: StreamLimitReason) => void;
};

function parseBytePosition(value: string): number | null {
  if (!CONTENT_LENGTH_PATTERN.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function createBoundedRangeHeader(
  rangeHeader: string | null,
  maxRangeBytes: number
): BoundedRangeResult {
  if (!rangeHeader) {
    return { ok: true, range: null };
  }

  const normalized = rangeHeader.trim();
  const match = normalized.match(BYTE_RANGE_PATTERN);
  if (!match) {
    return { ok: false, reason: "invalid-range" };
  }

  const [, startText = "", endText = ""] = match;
  if (!(startText || endText)) {
    return { ok: false, reason: "invalid-range" };
  }

  if (!startText) {
    const suffixLength = parseBytePosition(endText);
    if (!(suffixLength && suffixLength > 0)) {
      return { ok: false, reason: "invalid-range" };
    }

    return {
      ok: true,
      range: `bytes=-${Math.min(suffixLength, maxRangeBytes)}`,
    };
  }

  const start = parseBytePosition(startText);
  if (start === null) {
    return { ok: false, reason: "invalid-range" };
  }

  if (!endText) {
    return {
      ok: true,
      range: `bytes=${start}-${start + maxRangeBytes - 1}`,
    };
  }

  const end = parseBytePosition(endText);
  if (end === null || end < start) {
    return { ok: false, reason: "invalid-range" };
  }

  const boundedEnd = Math.min(end, start + maxRangeBytes - 1);
  return { ok: true, range: `bytes=${start}-${boundedEnd}` };
}

export function applyBoundedRangeHeader(
  headers: Headers,
  request: Request,
  maxRangeBytes: number
): BoundedRangeResult {
  headers.delete("Range");

  const rangeResult = createBoundedRangeHeader(
    request.headers.get("range"),
    maxRangeBytes
  );
  if (!(rangeResult.ok && rangeResult.range)) {
    return rangeResult;
  }

  headers.set("Range", rangeResult.range);
  return rangeResult;
}

export function getContentLengthLimitFailure(
  headers: Headers,
  maxBytes: number
): ContentLengthLimitFailure | null {
  const contentLength = headers.get("Content-Length");
  if (!contentLength) {
    return null;
  }

  const normalized = contentLength.trim();
  if (!CONTENT_LENGTH_PATTERN.test(normalized)) {
    return "invalid";
  }

  return BigInt(normalized) > BigInt(maxBytes) ? "too-large" : null;
}

export function limitResponseBody(
  body: ReadableStream<Uint8Array> | null,
  {
    abortController,
    maxBytes,
    maxDurationMs,
    onLimitExceeded,
  }: LimitResponseBodyOptions
): ReadableStream<Uint8Array> | null {
  if (!body) {
    return null;
  }

  const reader = body.getReader();
  let bytesRead = 0;
  let closed = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      timeout = setTimeout(() => {
        stop("duration", controller).catch(() => undefined);
      }, maxDurationMs);
    },
    async pull(controller) {
      if (closed) {
        return;
      }

      if (bytesRead >= maxBytes) {
        await stop("bytes", controller);
        return;
      }

      const result = await reader.read();
      if (closed) {
        return;
      }

      if (result.done) {
        close(controller);
        return;
      }

      const chunk = result.value;
      const remainingBytes = maxBytes - bytesRead;
      if (chunk.byteLength > remainingBytes) {
        controller.enqueue(chunk.slice(0, remainingBytes));
        bytesRead = maxBytes;
        await stop("bytes", controller);
        return;
      }

      bytesRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
    async cancel(reason) {
      await cancelUpstream(reason);
    },
  });

  function clearLimitTimer(): void {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  }

  function markClosed(): boolean {
    if (closed) {
      return false;
    }

    closed = true;
    clearLimitTimer();
    return true;
  }

  async function cancelReader(reason: unknown): Promise<void> {
    try {
      await reader.cancel(reason);
    } catch {
      // Some runtime streams reject cancellation after the fetch is aborted.
    }
  }

  function close(
    controller: ReadableStreamDefaultController<Uint8Array>
  ): void {
    if (markClosed()) {
      controller.close();
    }
  }

  async function stop(
    reason: StreamLimitReason,
    controller?: ReadableStreamDefaultController<Uint8Array>,
    cancelReason: unknown = reason
  ): Promise<void> {
    if (!markClosed()) {
      return;
    }

    onLimitExceeded?.(reason);
    abortController?.abort(reason);
    await cancelReader(cancelReason);

    if (controller) {
      controller.close();
    }
  }

  async function cancelUpstream(reason: unknown): Promise<void> {
    if (!markClosed()) {
      return;
    }

    abortController?.abort(reason);
    await cancelReader(reason);
  }
}
