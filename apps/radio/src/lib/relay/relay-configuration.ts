import { createOrderedServiceCatalog } from "@/lib/settings/ordered-service-catalog";

const RELAY_STORAGE_KEY = "radio-app-relay-configuration";
const RELAY_MANIFEST_PATH = ".well-known/avoid-radio-relay.json";
const STREAM_PROXY_PATH = "api/stream-proxy";
const MAX_RELAY_SERVICES = 8;
const MAX_RELAY_CAPABILITIES = 32;
const MAX_CAPABILITY_LENGTH = 64;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 4000;

const RELAY_CAPABILITY_PATTERN = /^(?:stream|hls)$/;
const LOOPBACK_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;
const TRAILING_SLASH_PATTERN = /\/$/;

export type RelayCapability = "hls" | "stream";

export type RelayServiceInput = {
  baseUrl: string;
  enabled?: boolean;
};

export type RelayService = {
  baseUrl: string;
  capabilities: RelayCapability[];
  enabled: boolean;
  kind: "stream-relay";
  name: string;
};

export type RelayConfiguration = {
  services: RelayService[];
  version: 1;
};

type RelayManifest = {
  capabilities: RelayCapability[];
  name?: string;
  version: 1;
};

type RelayConfigurationOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  storage?: Storage | null;
  timeoutMs?: number;
};

export class RelayConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RelayConfigurationError";
  }
}

function browserStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    LOOPBACK_IPV4_PATTERN.test(hostname)
  );
}

function applicationOrigin(): string | null {
  return typeof location === "undefined" ? null : location.origin;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new RelayConfigurationError("Relay URL is invalid", { cause: error });
  }

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLocalhost(url.hostname))
  ) {
    throw new RelayConfigurationError(
      "Relay URL must use HTTPS (HTTP is allowed only for localhost)"
    );
  }
  if (url.username || url.password) {
    throw new RelayConfigurationError("Relay URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new RelayConfigurationError(
      "Relay URL must not contain a query or fragment"
    );
  }
  if (url.origin === applicationOrigin()) {
    throw new RelayConfigurationError(
      "Relay URL must use a different origin so app credentials are never sent"
    );
  }

  url.pathname = url.pathname.replace(TRAILING_SLASHES_PATTERN, "") || "/";
  return url.toString().replace(TRAILING_SLASH_PATTERN, "");
}

function normalizeCapabilities(value: unknown): RelayCapability[] {
  if (!Array.isArray(value) || value.length > MAX_RELAY_CAPABILITIES) {
    throw new RelayConfigurationError("Relay capabilities are malformed");
  }

  const capabilities = new Set<RelayCapability>();
  for (const capability of value) {
    if (
      typeof capability !== "string" ||
      capability.length > MAX_CAPABILITY_LENGTH ||
      !RELAY_CAPABILITY_PATTERN.test(capability)
    ) {
      throw new RelayConfigurationError("Relay capability is invalid");
    }
    capabilities.add(capability as RelayCapability);
  }
  return [...capabilities];
}

function parseManifest(value: unknown): RelayManifest {
  if (!value || typeof value !== "object") {
    throw new RelayConfigurationError("Relay handshake response is malformed");
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.version !== 1) {
    throw new RelayConfigurationError("Relay handshake version is unsupported");
  }
  if (
    manifest.name !== undefined &&
    (typeof manifest.name !== "string" || manifest.name.length > 80)
  ) {
    throw new RelayConfigurationError("Relay name is invalid");
  }

  return {
    capabilities: normalizeCapabilities(manifest.capabilities),
    name: manifest.name,
    version: 1,
  };
}

function normalizeService(value: unknown): RelayService {
  if (!value || typeof value !== "object") {
    throw new RelayConfigurationError("Relay service is malformed");
  }
  const service = value as Record<string, unknown>;
  if (
    typeof service.enabled !== "boolean" ||
    typeof service.name !== "string" ||
    service.kind !== "stream-relay"
  ) {
    throw new RelayConfigurationError("Relay service is malformed");
  }
  return {
    baseUrl: normalizeBaseUrl(String(service.baseUrl ?? "")),
    capabilities: normalizeCapabilities(service.capabilities),
    enabled: service.enabled,
    kind: "stream-relay",
    name: service.name.slice(0, 80),
  };
}

const relayCatalog = createOrderedServiceCatalog<RelayService>({
  createError: (message) => new RelayConfigurationError(message),
  getKey: (service) => service.baseUrl,
  maxServices: MAX_RELAY_SERVICES,
  messages: {
    duplicate: "Relay services must be unique",
    limit: (max) => `At most ${max} relay services can be configured`,
    malformed: "Relay configuration is malformed",
    order: "Relay order must include every configured service once",
    unknown: "Relay order contains an unknown service",
  },
  normalizeService,
  storageKey: RELAY_STORAGE_KEY,
});

function endpoint(baseUrl: string, path: string): URL {
  return new URL(path, `${baseUrl}/`);
}

function createHandshakeSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { cleanup: () => void; signal: AbortSignal } {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) {
    abort();
  }
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("Relay handshake timed out", "TimeoutError")
      ),
    timeoutMs
  );

  return {
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
    signal: controller.signal,
  };
}

async function handshake(
  input: RelayServiceInput,
  options: RelayConfigurationOptions
): Promise<RelayService> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RelayConfigurationError("Relay handshake timeout is invalid");
  }
  const requestSignal = createHandshakeSignal(options.signal, timeoutMs);

  try {
    const response = await (options.fetchImpl ?? fetch)(
      endpoint(baseUrl, RELAY_MANIFEST_PATH),
      {
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json" },
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: requestSignal.signal,
      }
    );
    if (!response.ok) {
      throw new RelayConfigurationError(
        `Relay handshake failed with status ${response.status}`
      );
    }

    let manifest: RelayManifest;
    try {
      manifest = parseManifest(await response.json());
    } catch (error) {
      if (error instanceof RelayConfigurationError) {
        throw error;
      }
      throw new RelayConfigurationError(
        "Relay handshake response is malformed",
        {
          cause: error,
        }
      );
    }

    return {
      baseUrl,
      capabilities: manifest.capabilities,
      enabled: input.enabled ?? true,
      kind: "stream-relay",
      name: manifest.name?.trim() || new URL(baseUrl).host,
    };
  } catch (error) {
    if (error instanceof RelayConfigurationError) {
      throw error;
    }
    if (requestSignal.signal.aborted) {
      throw new RelayConfigurationError("Relay handshake was aborted", {
        cause: error,
      });
    }
    throw new RelayConfigurationError("Relay handshake failed", {
      cause: error,
    });
  } finally {
    requestSignal.cleanup();
  }
}

export function getRelayConfiguration(
  storage: Storage | null = browserStorage()
): RelayConfiguration {
  return relayCatalog.read(storage);
}

export async function saveRelayConfiguration(
  inputs: readonly RelayServiceInput[],
  options: RelayConfigurationOptions = {}
): Promise<RelayConfiguration> {
  if (inputs.length > MAX_RELAY_SERVICES) {
    throw new RelayConfigurationError(
      `At most ${MAX_RELAY_SERVICES} relay services can be configured`
    );
  }

  const normalizedBases = inputs.map((input) =>
    normalizeBaseUrl(input.baseUrl)
  );
  if (new Set(normalizedBases).size !== normalizedBases.length) {
    throw new RelayConfigurationError("Relay services must be unique");
  }

  const services = await Promise.all(
    inputs.map((input) => handshake(input, options))
  );
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  return relayCatalog.replace(services, storage);
}

export async function addRelayService(
  input: RelayServiceInput,
  options: RelayConfigurationOptions = {}
): Promise<RelayConfiguration> {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const current = getRelayConfiguration(storage);
  if (current.services.length >= MAX_RELAY_SERVICES) {
    throw new RelayConfigurationError(
      `At most ${MAX_RELAY_SERVICES} relay services can be configured`
    );
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (current.services.some((service) => service.baseUrl === baseUrl)) {
    throw new RelayConfigurationError("Relay service is already configured");
  }

  const service = await handshake(input, options);
  return relayCatalog.append(service, storage);
}

export function clearRelayConfiguration(
  storage: Storage | null = browserStorage()
): void {
  relayCatalog.clear(storage);
}

export function setRelayServiceEnabled(
  baseUrl: string,
  enabled: boolean,
  storage: Storage | null = browserStorage()
): RelayConfiguration {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return relayCatalog.setEnabled(normalizedBaseUrl, enabled, storage);
}

export function removeRelayService(
  baseUrl: string,
  storage: Storage | null = browserStorage()
): RelayConfiguration {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return relayCatalog.remove(normalizedBaseUrl, storage);
}

export function reorderRelayServices(
  orderedBaseUrls: readonly string[],
  storage: Storage | null = browserStorage()
): RelayConfiguration {
  return relayCatalog.reorder(orderedBaseUrls.map(normalizeBaseUrl), storage);
}

export function getStreamRelayUrls(
  upstreamUrl: string,
  format: "hls" | "progressive",
  configuration = getRelayConfiguration()
): string[] {
  const capability: RelayCapability = format === "hls" ? "hls" : "stream";
  return configuration.services
    .filter(
      (service) => service.enabled && service.capabilities.includes(capability)
    )
    .map((service) => {
      const url = endpoint(service.baseUrl, STREAM_PROXY_PATH);
      url.searchParams.set("url", upstreamUrl);
      return url.toString();
    });
}

export { RELAY_STORAGE_KEY };
