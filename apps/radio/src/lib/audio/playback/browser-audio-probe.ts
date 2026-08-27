export const DEFAULT_BROWSER_AUDIO_PROBE_TIMEOUT_MS = 4000;

export type BrowserAudioFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

type BrowserAudioProbeOptions = {
  accept: string;
  fetchImpl?: BrowserAudioFetch;
  isPlayableResponse?: (response: Response) => boolean | Promise<boolean>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Request aborted", "AbortError");
}

export async function probeBrowserReadableAudio(
  url: string,
  {
    accept,
    fetchImpl = fetch,
    isPlayableResponse = (response) =>
      (response.status === 200 || response.status === 206) && !!response.body,
    signal,
    timeoutMs = DEFAULT_BROWSER_AUDIO_PROBE_TIMEOUT_MS,
  }: BrowserAudioProbeOptions
): Promise<boolean> {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(signal ? abortReason(signal) : undefined);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) {
    abort();
  }
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Probe timed out", "TimeoutError")),
    timeoutMs
  );
  let response: Response | undefined;

  try {
    response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: accept, Range: "bytes=0-0" },
      method: "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    return await isPlayableResponse(response);
  } catch {
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal));
    }
    return false;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    await response?.body?.cancel().catch(() => undefined);
  }
}
