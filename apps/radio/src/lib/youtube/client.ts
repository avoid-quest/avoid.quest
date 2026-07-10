import {
  createBrowserInvidiousAdapter,
  createPipedAdapter,
  createYouTubeClient,
  type YouTubeClient,
  type YouTubeProviderAdapter,
  type YouTubeProviderAdapterOptions,
  YouTubeProviderError,
  type YouTubeProviderKind,
} from "@avoid.quest/platforms/youtube";

export type CuratedYouTubeProvider = {
  baseUrl: string;
  id: string;
  kind: YouTubeProviderKind;
};

// See YOUTUBE_PROVIDER_RESEARCH.md.
export const CURATED_YOUTUBE_PROVIDERS: readonly CuratedYouTubeProvider[] = [
  {
    baseUrl: "https://pipedapi.wireway.ch",
    id: "piped-wireway",
    kind: "piped",
  },
  {
    baseUrl: "https://yt.omada.cafe",
    id: "invidious-omada",
    kind: "invidious",
  },
  {
    baseUrl: "https://invidious.nikkosphere.com",
    id: "invidious-nikkosphere",
    kind: "invidious",
  },
  {
    baseUrl: "https://y.com.sb",
    id: "invidious-y-com-sb",
    kind: "invidious",
  },
];

export class YouTubeProviderUnavailableError extends Error {
  constructor() {
    super("No playback-capable public YouTube provider is currently available");
    this.name = "YouTubeProviderUnavailableError";
  }
}

type YouTubeClientOptions = Pick<
  YouTubeProviderAdapterOptions,
  "fetchImpl" | "timeoutMs" | "verifyMedia"
> & {
  operationTimeoutMs?: number;
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 5000;
const DEFAULT_OPERATION_TIMEOUT_MS = 25_000;

type DeadlineSignal = {
  cleanup: () => void;
  didTimeOut: () => boolean;
  signal: AbortSignal;
};

function createDeadlineSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  message: string
): DeadlineSignal {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  if (parentSignal?.aborted) {
    abortFromParent();
  }
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort(new DOMException(message, "TimeoutError"));
    }
  }, timeoutMs);

  return {
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    didTimeOut: () => timedOut,
    signal: controller.signal,
  };
}

async function withOperationDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<T> {
  const deadline = createDeadlineSignal(
    parentSignal,
    timeoutMs,
    "YouTube provider pool timed out"
  );

  try {
    return await operation(deadline.signal);
  } catch (error) {
    if (deadline.didTimeOut()) {
      throw new Error("YouTube provider pool timed out", { cause: error });
    }
    throw error;
  } finally {
    deadline.cleanup();
  }
}

async function withProviderDeadline<T>(
  provider: YouTubeProviderAdapter,
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<T> {
  const deadline = createDeadlineSignal(
    parentSignal,
    timeoutMs,
    "YouTube provider operation timed out"
  );
  try {
    return await operation(deadline.signal);
  } catch (error) {
    if (deadline.didTimeOut()) {
      throw new YouTubeProviderError("YouTube provider operation timed out", {
        cause: error,
        code: "timeout",
        kind: provider.kind,
        providerId: provider.id,
      });
    }
    throw error;
  } finally {
    deadline.cleanup();
  }
}

function applyProviderDeadline(
  provider: YouTubeProviderAdapter,
  timeoutMs: number
): YouTubeProviderAdapter {
  return {
    id: provider.id,
    kind: provider.kind,
    probe: (signal) =>
      withProviderDeadline(
        provider,
        (deadlineSignal) => provider.probe(deadlineSignal),
        signal,
        timeoutMs
      ),
    resolveItem: (url, signal) =>
      withProviderDeadline(
        provider,
        (deadlineSignal) => provider.resolveItem(url, deadlineSignal),
        signal,
        timeoutMs
      ),
    resolveStream: (videoId, signal) =>
      withProviderDeadline(
        provider,
        (deadlineSignal) => provider.resolveStream(videoId, deadlineSignal),
        signal,
        timeoutMs
      ),
    search: (query, filter, signal) =>
      withProviderDeadline(
        provider,
        (deadlineSignal) => provider.search(query, filter, deadlineSignal),
        signal,
        timeoutMs
      ),
  };
}

export function createCuratedYouTubeClient(
  providers: readonly CuratedYouTubeProvider[] = CURATED_YOUTUBE_PROVIDERS,
  options: YouTubeClientOptions = {}
): YouTubeClient {
  const {
    operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
    ...providerOptions
  } = options;
  if (!Number.isFinite(operationTimeoutMs) || operationTimeoutMs <= 0) {
    throw new TypeError("YouTube provider pool timeout is invalid");
  }
  const adapters = providers.map((provider) => {
    const adapterOptions = {
      ...providerOptions,
      baseUrl: provider.baseUrl,
      id: provider.id,
      timeoutMs,
    };
    const adapter =
      provider.kind === "invidious"
        ? createBrowserInvidiousAdapter(adapterOptions)
        : createPipedAdapter(adapterOptions);
    return applyProviderDeadline(adapter, timeoutMs);
  });
  if (adapters.length === 0) {
    throw new YouTubeProviderUnavailableError();
  }
  const client = createYouTubeClient(adapters);
  return {
    providers: client.providers,
    resolveItem: (url, signal) =>
      withOperationDeadline(
        (deadlineSignal) => client.resolveItem(url, deadlineSignal),
        signal,
        operationTimeoutMs
      ),
    resolveStream: (videoId, signal) =>
      withOperationDeadline(
        (deadlineSignal) => client.resolveStream(videoId, deadlineSignal),
        signal,
        operationTimeoutMs
      ),
    search: (query, filter, signal) =>
      withOperationDeadline(
        (deadlineSignal) => client.search(query, filter, deadlineSignal),
        signal,
        operationTimeoutMs
      ),
  };
}

export function getYouTubeClient(): YouTubeClient {
  return createCuratedYouTubeClient();
}
