import {
  createBrowserInvidiousAdapter,
  createPipedAdapter,
  type YouTubeProviderKind,
} from "@avoid.quest/platforms/youtube";
import { createOrderedServiceCatalog } from "@/lib/settings/ordered-service-catalog";

const YOUTUBE_PROVIDER_STORAGE_KEY = "radio-app-youtube-provider-configuration";
const MAX_YOUTUBE_PROVIDER_SERVICES = 8;
const MAX_PROVIDER_URL_LENGTH = 2048;
const MAX_PROVIDER_LABEL_LENGTH = 80;
const LOOPBACK_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/;
const TRAILING_SLASH_PATTERN = /\/$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;

export type YouTubeProviderServiceInput = {
  baseUrl: string;
  enabled?: boolean;
  id?: string;
  kind: YouTubeProviderKind;
  name?: string;
};

export type YouTubeProviderService = {
  baseUrl: string;
  enabled: boolean;
  id: string;
  kind: YouTubeProviderKind;
  name: string;
};

export type YouTubeProviderConfiguration = {
  services: YouTubeProviderService[];
  version: 1;
};

export type YouTubeProviderVerificationOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  storage?: Storage | null;
  timeoutMs?: number;
};

export class YouTubeProviderConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "YouTubeProviderConfigurationError";
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

function normalizeBaseUrl(value: string): string {
  if (typeof value !== "string" || value.length > MAX_PROVIDER_URL_LENGTH) {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider URL is invalid"
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider URL is invalid",
      { cause: error }
    );
  }

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLocalhost(url.hostname))
  ) {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider URL must use HTTPS (HTTP is allowed only for localhost)"
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider URL must not contain credentials, a query, or a fragment"
    );
  }

  url.pathname = url.pathname.replace(TRAILING_SLASHES_PATTERN, "") || "/";
  return url.toString().replace(TRAILING_SLASH_PATTERN, "");
}

function normalizeKind(value: unknown): YouTubeProviderKind {
  if (value !== "invidious" && value !== "piped") {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider kind is invalid"
    );
  }
  return value;
}

function normalizeLabel(
  value: unknown,
  fallback: string,
  label: "ID" | "name"
): string {
  const normalized = value === undefined ? fallback : String(value).trim();
  if (!normalized || normalized.length > MAX_PROVIDER_LABEL_LENGTH) {
    throw new YouTubeProviderConfigurationError(
      `YouTube provider ${label} is invalid`
    );
  }
  return normalized;
}

function normalizeServiceInput(
  input: YouTubeProviderServiceInput
): YouTubeProviderService {
  const kind = normalizeKind(input.kind);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const url = new URL(baseUrl);
  const defaultId = `${kind}:${url.host}${url.pathname === "/" ? "" : url.pathname}`;

  return {
    baseUrl,
    enabled: input.enabled ?? true,
    id: normalizeLabel(input.id, defaultId, "ID"),
    kind,
    name: normalizeLabel(input.name, url.host, "name"),
  };
}

function normalizeStoredService(value: unknown): YouTubeProviderService {
  if (!value || typeof value !== "object") {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider service is malformed"
    );
  }
  const service = value as Record<string, unknown>;
  if (
    typeof service.baseUrl !== "string" ||
    typeof service.enabled !== "boolean" ||
    typeof service.id !== "string" ||
    typeof service.name !== "string"
  ) {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider service is malformed"
    );
  }
  return normalizeServiceInput({
    baseUrl: service.baseUrl,
    enabled: service.enabled,
    id: service.id,
    kind: normalizeKind(service.kind),
    name: service.name,
  });
}

function validateEndpoints(services: readonly YouTubeProviderService[]): void {
  const endpoints = services.map(({ baseUrl, kind }) => `${kind}:${baseUrl}`);
  if (new Set(endpoints).size !== endpoints.length) {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider endpoints must be unique"
    );
  }
}

const youtubeProviderCatalog =
  createOrderedServiceCatalog<YouTubeProviderService>({
    createError: (message) => new YouTubeProviderConfigurationError(message),
    getKey: (service) => service.id,
    maxServices: MAX_YOUTUBE_PROVIDER_SERVICES,
    messages: {
      duplicate: "YouTube provider IDs must be unique",
      limit: (max) => `At most ${max} YouTube providers can be configured`,
      malformed: "YouTube provider configuration is malformed",
      order:
        "YouTube provider order must include every configured provider once",
      unknown: "YouTube provider order contains an unknown provider",
    },
    normalizeService: normalizeStoredService,
    storageKey: YOUTUBE_PROVIDER_STORAGE_KEY,
    validateServices: validateEndpoints,
  });

function normalizeId(id: string): string {
  return normalizeLabel(id, "", "ID");
}

export function getYouTubeProviderConfiguration(
  storage: Storage | null = browserStorage()
): YouTubeProviderConfiguration {
  return youtubeProviderCatalog.read(storage);
}

export function removeYouTubeProviderService(
  id: string,
  storage: Storage | null = browserStorage()
): YouTubeProviderConfiguration {
  const normalizedId = normalizeId(id);
  return youtubeProviderCatalog.remove(normalizedId, storage);
}

export function setYouTubeProviderServiceEnabled(
  id: string,
  enabled: boolean,
  storage: Storage | null = browserStorage()
): YouTubeProviderConfiguration {
  const normalizedId = normalizeId(id);
  return youtubeProviderCatalog.setEnabled(normalizedId, enabled, storage);
}

export function reorderYouTubeProviderServices(
  orderedIds: readonly string[],
  storage: Storage | null = browserStorage()
): YouTubeProviderConfiguration {
  const normalizedIds = orderedIds.map(normalizeId);
  return youtubeProviderCatalog.reorder(normalizedIds, storage);
}

export function clearYouTubeProviderConfiguration(
  storage: Storage | null = browserStorage()
): void {
  youtubeProviderCatalog.clear(storage);
}

export function resetYouTubeProviderConfiguration(
  storage: Storage | null = browserStorage()
): YouTubeProviderConfiguration {
  clearYouTubeProviderConfiguration(storage);
  return youtubeProviderCatalog.read(storage);
}

export async function addVerifiedYouTubeProviderService(
  input: YouTubeProviderServiceInput,
  options: YouTubeProviderVerificationOptions = {}
): Promise<YouTubeProviderConfiguration> {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const service = normalizeServiceInput(input);
  const current = getYouTubeProviderConfiguration(storage);
  if (current.services.length >= MAX_YOUTUBE_PROVIDER_SERVICES) {
    throw new YouTubeProviderConfigurationError(
      `At most ${MAX_YOUTUBE_PROVIDER_SERVICES} YouTube providers can be configured`
    );
  }
  if (current.services.some(({ id }) => id === service.id)) {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider ID is already configured"
    );
  }
  if (
    current.services.some(
      ({ baseUrl, kind }) =>
        baseUrl === service.baseUrl && kind === service.kind
    )
  ) {
    throw new YouTubeProviderConfigurationError(
      "YouTube provider endpoint is already configured"
    );
  }
  const adapterOptions = {
    baseUrl: service.baseUrl,
    fetchImpl: options.fetchImpl,
    id: service.id,
    timeoutMs: options.timeoutMs,
    verifyMedia: false,
  };
  const adapter =
    service.kind === "invidious"
      ? createBrowserInvidiousAdapter(adapterOptions)
      : createPipedAdapter(adapterOptions);
  await adapter.probe(options.signal);
  return youtubeProviderCatalog.append(service, storage);
}

export { MAX_YOUTUBE_PROVIDER_SERVICES, YOUTUBE_PROVIDER_STORAGE_KEY };
