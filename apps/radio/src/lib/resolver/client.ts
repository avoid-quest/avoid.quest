import {
  createHttpResolverAdapter,
  createResolverBroker,
  parseResolverResolution,
  parseResolverSearchResults,
  RESOLVER_CAPABILITIES,
  type ResolverAdapter,
  ResolverAdapterError,
  type ResolverBroker,
  type ResolverCapability,
  type ResolverProvider,
  type ResolverResolution,
  type ResolverResolveRequest,
  type ResolverSearchFilter,
  type ResolverSearchRequest,
  type ResolverSearchResultMap,
} from "@avoid.quest/platforms/resolver";
import { getCompatibilityFallbacksEnabled } from "../compatibility-fallback-policy";
import {
  getResolverConfiguration,
  type ResolverService,
} from "./resolver-configuration";

const APP_SERVER_RESOLVER_ID = "app-server";
const HASH_64_OFFSET = 14_695_981_039_346_656_037n;
const HASH_64_PRIME = 1_099_511_628_211n;

type ServerResult<T> =
  | { data: T; ok: true }
  | { error: { status: number }; ok: false };

type ServerResolution = {
  expiresAt?: unknown;
  format?: unknown;
  metadata: unknown;
  streamUrl: unknown;
};

export type ResolverServerFunctions = {
  bandcampSearch(input: {
    filter: ResolverSearchFilter<"bandcamp">;
    query: string;
  }): Promise<ServerResult<{ results: ResolverSearchResultMap["bandcamp"] }>>;
  radioGardenSearch(input: {
    query: string;
  }): Promise<
    ServerResult<{ results: ResolverSearchResultMap["radiogarden"] }>
  >;
  resolvePlatformItem(input: {
    url: string;
  }): Promise<ServerResult<ServerResolution>>;
  soundCloudSearch(input: {
    query: string;
  }): Promise<ServerResult<{ results: ResolverSearchResultMap["soundcloud"] }>>;
};

export type ResolverClientOptions = {
  fetchImpl?: typeof fetch;
  serverFunctions?: Partial<ResolverServerFunctions>;
  storage?: Storage | null;
  timeoutMs?: number;
};

function stableExternalResolverId(baseUrl: string): string {
  let hash = HASH_64_OFFSET;
  for (let index = 0; index < baseUrl.length; index += 1) {
    hash = BigInt.asUintN(
      64,
      hash * HASH_64_PRIME + BigInt(baseUrl.charCodeAt(index))
    );
  }
  return `external:${hash.toString(36)}`;
}

function unsupportedCapability(adapterId: string): ResolverAdapterError {
  return new ResolverAdapterError(
    "Resolver does not support the requested capability",
    { adapterId, code: "unsupported-capability" }
  );
}

function requiredCapability(
  provider: ResolverProvider,
  operation: "resolve" | "search"
): ResolverCapability {
  return `${provider}:${operation}`;
}

function createConfiguredHttpAdapter(
  service: ResolverService,
  options: Pick<ResolverClientOptions, "fetchImpl" | "timeoutMs">
): ResolverAdapter {
  const id = stableExternalResolverId(service.baseUrl);
  const configuredCapabilities = new Set(service.capabilities);
  const httpAdapter = createHttpResolverAdapter({
    baseUrl: service.baseUrl,
    fetchImpl: options.fetchImpl,
    id,
    timeoutMs: options.timeoutMs,
  });

  function requireConfiguredCapability(capability: ResolverCapability): void {
    if (!configuredCapabilities.has(capability)) {
      throw unsupportedCapability(id);
    }
  }

  return {
    id,
    probe: async (signal) => {
      const liveManifest = await httpAdapter.probe(signal);
      const liveCapabilities = new Set(liveManifest.capabilities);
      return {
        capabilities: service.capabilities.filter((capability) =>
          liveCapabilities.has(capability)
        ),
        name: service.name,
        protocol: "avoid-radio-resolver",
        version: 1,
      } as const satisfies typeof liveManifest;
    },
    search: async <P extends ResolverProvider>(
      request: ResolverSearchRequest<P>
    ): Promise<ResolverSearchResultMap[P]> => {
      requireConfiguredCapability(
        requiredCapability(request.provider, "search")
      );
      return await httpAdapter.search(request);
    },
    resolve: async <P extends ResolverProvider>(
      request: ResolverResolveRequest<P>
    ): Promise<ResolverResolution<P>> => {
      requireConfiguredCapability(
        requiredCapability(request.provider, "resolve")
      );
      return await httpAdapter.resolve(request);
    },
  };
}

const DEFAULT_SERVER_FUNCTIONS: ResolverServerFunctions = {
  bandcampSearch: async (input) => {
    const { bandcampSearch } = await import("@/utils/search.functions");
    return await bandcampSearch({ data: input });
  },
  radioGardenSearch: async (input) => {
    const { radioGardenSearch } = await import(
      "@/utils/radio-garden.functions"
    );
    return await radioGardenSearch({ data: input });
  },
  resolvePlatformItem: async (input) => {
    const { loadPlatformItem } = await import("@/utils/platform.functions");
    return await loadPlatformItem({ data: input });
  },
  soundCloudSearch: async (input) => {
    const { soundcloudSearch } = await import("@/utils/search.functions");
    return await soundcloudSearch({ data: input });
  },
};

function createServerError(
  code: "aborted" | "http" | "invalid-schema" | "network-or-cors",
  status?: number
): ResolverAdapterError {
  const messages = {
    aborted: "Resolver request was aborted",
    http: "App server resolver failed",
    "invalid-schema": "App server resolver returned an invalid response",
    "network-or-cors": "App server resolver is unavailable",
  } as const;
  return new ResolverAdapterError(messages[code], {
    adapterId: APP_SERVER_RESOLVER_ID,
    code,
    retryable: code !== "aborted",
    status,
  });
}

function normalizeStatus(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
    ? value
    : undefined;
}

function waitForServerResult<T>(
  request: () => Promise<ServerResult<T>>,
  signal?: AbortSignal
): Promise<ServerResult<T>> {
  if (signal?.aborted) {
    return Promise.reject(createServerError("aborted"));
  }
  if (!signal) {
    return request();
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(createServerError("aborted"));
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    request().then(
      (result) => {
        cleanup();
        resolve(result);
      },
      () => {
        cleanup();
        reject(createServerError("network-or-cors"));
      }
    );
  });
}

async function runServerFunction<T>(
  request: () => Promise<ServerResult<T>>,
  signal?: AbortSignal
): Promise<T> {
  let result: ServerResult<T>;
  try {
    result = await waitForServerResult(request, signal);
  } catch (error) {
    if (error instanceof ResolverAdapterError) {
      throw error;
    }
    throw createServerError("network-or-cors");
  }
  if (!result.ok) {
    throw createServerError("http", normalizeStatus(result.error.status));
  }
  return result.data;
}

function mapServerResolution<P extends ResolverProvider>(
  provider: P,
  value: ServerResolution
): ResolverResolution<P> {
  return parseResolverResolution(provider, value, APP_SERVER_RESOLVER_ID, {
    allowRelativeStreamUrls: true,
  });
}

export function createAppServerResolverAdapter(
  overrides: Partial<ResolverServerFunctions> = {}
): ResolverAdapter {
  const serverFunctions = { ...DEFAULT_SERVER_FUNCTIONS, ...overrides };
  return {
    id: APP_SERVER_RESOLVER_ID,
    probe: () =>
      Promise.resolve({
        capabilities: RESOLVER_CAPABILITIES,
        name: "Avoid Radio app server",
        protocol: "avoid-radio-resolver",
        version: 1,
      }),
    search: async <P extends ResolverProvider>(
      request: ResolverSearchRequest<P>
    ): Promise<ResolverSearchResultMap[P]> => {
      switch (request.provider) {
        case "bandcamp": {
          const { results } = await runServerFunction(
            () =>
              serverFunctions.bandcampSearch({
                filter: request.filter ?? "",
                query: request.query,
              }),
            request.signal
          );
          return parseResolverSearchResults(
            request.provider,
            results,
            APP_SERVER_RESOLVER_ID
          );
        }
        case "radiogarden": {
          const { results } = await runServerFunction(
            () => serverFunctions.radioGardenSearch({ query: request.query }),
            request.signal
          );
          return parseResolverSearchResults(
            request.provider,
            results,
            APP_SERVER_RESOLVER_ID
          );
        }
        case "soundcloud": {
          const { results } = await runServerFunction(
            () => serverFunctions.soundCloudSearch({ query: request.query }),
            request.signal
          );
          return parseResolverSearchResults(
            request.provider,
            results,
            APP_SERVER_RESOLVER_ID
          );
        }
        default:
          throw createServerError("invalid-schema");
      }
    },
    resolve: async <P extends ResolverProvider>(
      request: ResolverResolveRequest<P>
    ): Promise<ResolverResolution<P>> =>
      mapServerResolution(
        request.provider,
        await runServerFunction(
          () => serverFunctions.resolvePlatformItem({ url: request.url }),
          request.signal
        )
      ),
  };
}

export function createConfiguredResolverBroker(
  options: ResolverClientOptions = {}
): ResolverBroker {
  const configuration =
    options.storage === undefined
      ? getResolverConfiguration()
      : getResolverConfiguration(options.storage);
  const configuredAdapters = configuration.services
    .filter((service) => service.enabled)
    .map((service) => createConfiguredHttpAdapter(service, options));
  const compatibilityFallbacksEnabled =
    options.storage === undefined
      ? getCompatibilityFallbacksEnabled()
      : getCompatibilityFallbacksEnabled(options.storage);
  return createResolverBroker(
    compatibilityFallbacksEnabled
      ? [
          ...configuredAdapters,
          createAppServerResolverAdapter(options.serverFunctions),
        ]
      : configuredAdapters
  );
}

export { APP_SERVER_RESOLVER_ID };
