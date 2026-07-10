import {
  createHttpResolverAdapter,
  isResolverCapability,
  RESOLVER_CAPABILITIES,
  type ResolverCapability,
  type ResolverManifest,
} from "@avoid.quest/platforms/resolver";
import { createOrderedServiceCatalog } from "@/lib/settings/ordered-service-catalog";

const RESOLVER_STORAGE_KEY = "radio-app-resolver-configuration";
const MAX_RESOLVER_SERVICES = 8;
const MAX_RESOLVER_URL_LENGTH = 2048;
const MAX_RESOLVER_NAME_LENGTH = 80;
const MAX_RESOLVER_CAPABILITIES = RESOLVER_CAPABILITIES.length;
const LOOPBACK_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/;
const TRAILING_SLASH_PATTERN = /\/$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;

export type ResolverServiceInput = {
  baseUrl: string;
  enabled?: boolean;
};

export type ResolverService = {
  baseUrl: string;
  capabilities: ResolverCapability[];
  enabled: boolean;
  kind: "platform-resolver";
  name: string;
};

export type ResolverConfiguration = {
  services: ResolverService[];
  version: 1;
};

type ResolverServiceVerifier = (
  baseUrl: string,
  signal?: AbortSignal
) => Promise<ResolverManifest>;

export type ResolverVerificationOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  storage?: Storage | null;
  timeoutMs?: number;
  verify?: ResolverServiceVerifier;
};

export class ResolverConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResolverConfigurationError";
  }
}

function browserStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function applicationOrigin(): string | null {
  return typeof location === "undefined" ? null : location.origin;
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    LOOPBACK_IPV4_PATTERN.test(hostname)
  );
}

function normalizeBaseUrl(value: string): string {
  if (typeof value !== "string" || value.length > MAX_RESOLVER_URL_LENGTH) {
    throw new ResolverConfigurationError("Resolver URL is invalid");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new ResolverConfigurationError("Resolver URL is invalid", {
      cause: error,
    });
  }

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLocalhost(url.hostname))
  ) {
    throw new ResolverConfigurationError(
      "Resolver URL must use HTTPS (HTTP is allowed only for localhost)"
    );
  }
  if (url.username || url.password) {
    throw new ResolverConfigurationError(
      "Resolver URL must not contain credentials"
    );
  }
  if (url.search || url.hash) {
    throw new ResolverConfigurationError(
      "Resolver URL must not contain a query or fragment"
    );
  }
  if (url.origin === applicationOrigin()) {
    throw new ResolverConfigurationError(
      "Resolver URL must use a different origin so app credentials are never sent"
    );
  }

  url.pathname = url.pathname.replace(TRAILING_SLASHES_PATTERN, "") || "/";
  return url.toString().replace(TRAILING_SLASH_PATTERN, "");
}

function normalizeCapabilities(value: unknown): ResolverCapability[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_RESOLVER_CAPABILITIES
  ) {
    throw new ResolverConfigurationError("Resolver capabilities are malformed");
  }

  const capabilities = new Set<ResolverCapability>();
  for (const capability of value) {
    if (!isResolverCapability(capability)) {
      throw new ResolverConfigurationError("Resolver capability is invalid");
    }
    capabilities.add(capability);
  }
  return [...capabilities];
}

function normalizeManifest(value: unknown): ResolverManifest {
  if (!value || typeof value !== "object") {
    throw new ResolverConfigurationError(
      "Resolver handshake response is malformed"
    );
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.protocol !== "avoid-radio-resolver" ||
    manifest.version !== 1 ||
    typeof manifest.name !== "string" ||
    !manifest.name.trim() ||
    manifest.name.length > MAX_RESOLVER_NAME_LENGTH
  ) {
    throw new ResolverConfigurationError(
      "Resolver handshake response is malformed"
    );
  }

  return {
    capabilities: normalizeCapabilities(manifest.capabilities),
    name: manifest.name.trim(),
    protocol: "avoid-radio-resolver",
    version: 1,
  };
}

function normalizeService(value: unknown): ResolverService {
  if (!value || typeof value !== "object") {
    throw new ResolverConfigurationError("Resolver service is malformed");
  }
  const service = value as Record<string, unknown>;
  if (
    typeof service.baseUrl !== "string" ||
    typeof service.enabled !== "boolean" ||
    service.kind !== "platform-resolver" ||
    typeof service.name !== "string" ||
    !service.name.trim() ||
    service.name.length > MAX_RESOLVER_NAME_LENGTH
  ) {
    throw new ResolverConfigurationError("Resolver service is malformed");
  }

  return {
    baseUrl: normalizeBaseUrl(service.baseUrl),
    capabilities: normalizeCapabilities(service.capabilities),
    enabled: service.enabled,
    kind: "platform-resolver",
    name: service.name.trim(),
  };
}

const resolverCatalog = createOrderedServiceCatalog<ResolverService>({
  createError: (message) => new ResolverConfigurationError(message),
  getKey: (service) => service.baseUrl,
  maxServices: MAX_RESOLVER_SERVICES,
  messages: {
    duplicate: "Resolver services must be unique",
    limit: (max) => `At most ${max} resolver services can be configured`,
    malformed: "Resolver configuration is malformed",
    order: "Resolver order must include every configured service once",
    unknown: "Resolver order contains an unknown service",
  },
  normalizeService,
  storageKey: RESOLVER_STORAGE_KEY,
});

async function verifyResolverService(
  baseUrl: string,
  options: ResolverVerificationOptions
): Promise<ResolverManifest> {
  try {
    const manifest = options.verify
      ? await options.verify(baseUrl, options.signal)
      : await createHttpResolverAdapter({
          baseUrl,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
        }).probe(options.signal);
    return normalizeManifest(manifest);
  } catch (error) {
    if (error instanceof ResolverConfigurationError) {
      throw error;
    }
    throw new ResolverConfigurationError("Resolver verification failed", {
      cause: error,
    });
  }
}

export function getResolverConfiguration(
  storage: Storage | null = browserStorage()
): ResolverConfiguration {
  return resolverCatalog.read(storage);
}

export async function addResolverService(
  input: ResolverServiceInput,
  options: ResolverVerificationOptions = {}
): Promise<ResolverConfiguration> {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const current = getResolverConfiguration(storage);
  if (current.services.length >= MAX_RESOLVER_SERVICES) {
    throw new ResolverConfigurationError(
      `At most ${MAX_RESOLVER_SERVICES} resolver services can be configured`
    );
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (current.services.some((service) => service.baseUrl === baseUrl)) {
    throw new ResolverConfigurationError(
      "Resolver service is already configured"
    );
  }

  const manifest = await verifyResolverService(baseUrl, options);
  return resolverCatalog.append(
    {
      baseUrl,
      capabilities: [...manifest.capabilities],
      enabled: input.enabled ?? true,
      kind: "platform-resolver",
      name: manifest.name,
    },
    storage
  );
}

export function setResolverServiceEnabled(
  baseUrl: string,
  enabled: boolean,
  storage: Storage | null = browserStorage()
): ResolverConfiguration {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return resolverCatalog.setEnabled(normalizedBaseUrl, enabled, storage);
}

export function removeResolverService(
  baseUrl: string,
  storage: Storage | null = browserStorage()
): ResolverConfiguration {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return resolverCatalog.remove(normalizedBaseUrl, storage);
}

export function reorderResolverServices(
  orderedBaseUrls: readonly string[],
  storage: Storage | null = browserStorage()
): ResolverConfiguration {
  const normalizedBaseUrls = orderedBaseUrls.map(normalizeBaseUrl);
  return resolverCatalog.reorder(normalizedBaseUrls, storage);
}

export function clearResolverConfiguration(
  storage: Storage | null = browserStorage()
): void {
  resolverCatalog.clear(storage);
}

export { MAX_RESOLVER_SERVICES, RESOLVER_STORAGE_KEY };
