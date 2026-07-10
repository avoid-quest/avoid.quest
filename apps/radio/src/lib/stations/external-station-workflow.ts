import type { RadioBrowserStation } from "@avoid.quest/platforms/radiobrowser";
import type { Radio } from "@/lib/audio";
import type { RadioRecord } from "@/lib/collections";
import { createPlatformRadio } from "@/lib/external-url/utils";
import type {
  PlatformMetadata,
  RadioGardenSearchResult,
} from "@/lib/platform-types";

export type ExternalStationError = {
  code: string;
  message: string;
};

export type ExternalStationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ExternalStationError };

type CollectionStationDependencies = {
  addSavedRadio: (radio: Omit<RadioRecord, "id">) => void;
  getSavedRadios: () => Iterable<Pick<RadioRecord, "order">>;
  removeSessionRadio?: (id: string | number) => void;
};

type SessionStationDependencies = {
  addSessionRadio: (radio: Radio) => void;
  getSessionRadios: () => Iterable<Radio>;
  removeSessionRadio: (id: string | number) => void;
};

type RadioGardenResolveLoader = (
  channelId: string,
  canonicalUrl: string
) => Promise<
  ExternalStationResult<{
    format?: "hls" | "progressive";
    streamUrl: string;
  }>
>;

type PlatformResolveLoader = (url: string) => Promise<
  ExternalStationResult<{
    format?: "hls" | "progressive";
    metadata: PlatformMetadata;
    streamUrl: string;
  }>
>;

export type ExternalStationResolutionAdapters = {
  platform?: {
    resolve: PlatformResolveLoader;
  };
  radioGarden?: {
    resolveStream: RadioGardenResolveLoader;
  };
};

export type ExternalStationResolutionWorkflowDependencies = {
  adapters: ExternalStationResolutionAdapters;
  collection: CollectionStationDependencies;
  session?: SessionStationDependencies;
};

type ResolvedStationData = { radio: Radio };

type SavedStationData = {
  order: number;
  radio: Radio;
  removedSessionRadioId?: string | number;
};

function normalizeWorkflowError(
  error: unknown,
  fallback: ExternalStationError
): ExternalStationError {
  if (error instanceof Error && error.message.trim()) {
    return {
      code: fallback.code,
      message: error.message,
    };
  }

  return fallback;
}

function normalizeRequiredString(value: string): string {
  return value.trim();
}

function normalizeOptionalString(
  value: string | undefined
): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

const REQUIRED_METADATA_STRING_KEYS = new Set([
  "channelId",
  "deviceId",
  "deviceLabel",
  "fileName",
  "itemType",
  "platform",
  "url",
]);

function normalizeMetadataValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return (
      trimmed ||
      (key && REQUIRED_METADATA_STRING_KEYS.has(key) ? "" : undefined)
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeMetadataValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) => {
        const normalized = normalizeMetadataValue(entry, key);
        return normalized === undefined ? [] : [[key, normalized]];
      })
    );
  }
  return value;
}

function normalizePlatformMetadata(
  metadata: PlatformMetadata | undefined
): PlatformMetadata | undefined {
  if (!metadata) {
    return;
  }
  return normalizeMetadataValue(metadata) as PlatformMetadata;
}

export function createRadioGardenRadio(
  result: RadioGardenSearchResult,
  streamUrl: string,
  name = result.title,
  streamFormat?: Radio["streamFormat"]
): Radio {
  return {
    id: `rg_${result.channelId}`,
    name: normalizeRequiredString(name),
    streamUrl: normalizeRequiredString(streamUrl),
    ...(streamFormat ? { streamFormat } : {}),
    description: normalizeOptionalString(result.subtitle),
    placeTitle: normalizeOptionalString(result.placeTitle),
    countryTitle: normalizeOptionalString(result.countryTitle),
    websiteUrl: normalizeOptionalString(result.website),
    enabled: true,
    isSystem: false,
    platformMetadata: {
      platform: "radiogarden",
      itemType: "channel",
      url: normalizeRequiredString(result.url),
      channelId: result.channelId,
      name: normalizeRequiredString(name),
      subtitle: normalizeOptionalString(result.subtitle),
      placeTitle: normalizeOptionalString(result.placeTitle),
      countryTitle: normalizeOptionalString(result.countryTitle),
      website: normalizeOptionalString(result.website),
    },
  };
}

export function createRadioBrowserRadio(station: RadioBrowserStation): Radio {
  const stationUuid = normalizeRequiredString(station.stationUuid);
  const resolvedUrl = normalizeRequiredString(station.urlResolved);
  const canonicalUrl = normalizeRequiredString(station.url) || resolvedUrl;

  return {
    id: `rb_${stationUuid}`,
    name: normalizeRequiredString(station.name),
    streamUrl: resolvedUrl || canonicalUrl,
    logoUrl: normalizeOptionalString(station.favicon),
    description: normalizeOptionalString(station.tags.join(", ")),
    websiteUrl: normalizeOptionalString(station.homepage),
    placeTitle: normalizeOptionalString(station.state),
    countryTitle: normalizeOptionalString(station.country),
    enabled: true,
    isSystem: false,
    platformMetadata: {
      platform: "radio-browser",
      itemType: "station",
      url: canonicalUrl,
      stationUuid,
      hls: station.hls,
    },
  };
}

export function createImportedStationRadio(input: {
  description?: string;
  logoUrl?: string;
  name: string;
  streamUrl: string;
  websiteUrl?: string;
}): Radio {
  return {
    name: input.name.trim(),
    streamUrl: input.streamUrl.trim(),
    logoUrl: input.logoUrl?.trim() || undefined,
    description: input.description?.trim() || undefined,
    websiteUrl: input.websiteUrl?.trim() || undefined,
    enabled: true,
    isSystem: false,
  };
}

export function getNextSavedRadioOrder(
  radios: Iterable<Pick<RadioRecord, "order">>
): number {
  let maxOrder = 0;
  for (const radio of radios) {
    maxOrder = Math.max(maxOrder, radio.order || 0);
  }
  return maxOrder + 1;
}

export function toSavedRadioRecord(
  radio: Radio,
  order: number
): Omit<RadioRecord, "id"> {
  return {
    name: normalizeRequiredString(radio.name),
    streamUrl: normalizeRequiredString(radio.streamUrl),
    ...(radio.streamFormat ? { streamFormat: radio.streamFormat } : {}),
    logoUrl: normalizeOptionalString(radio.logoUrl),
    description: normalizeOptionalString(radio.description),
    websiteUrl: normalizeOptionalString(radio.websiteUrl),
    placeTitle: normalizeOptionalString(radio.placeTitle),
    countryTitle: normalizeOptionalString(radio.countryTitle),
    order,
    enabled: true,
    isSystem: false,
    platformMetadata: normalizePlatformMetadata(radio.platformMetadata),
    metadataConfig: radio.metadataConfig,
  };
}

export function saveResolvedStationToCollection(
  radio: Radio,
  dependencies: CollectionStationDependencies,
  options?: { removeSessionRadioId?: string | number }
): { order: number; radio: Radio; removedSessionRadioId?: string | number } {
  const order = getNextSavedRadioOrder(dependencies.getSavedRadios());
  dependencies.addSavedRadio(toSavedRadioRecord(radio, order));

  if (options?.removeSessionRadioId !== undefined) {
    dependencies.removeSessionRadio?.(options.removeSessionRadioId);
  }

  return {
    order,
    radio,
    removedSessionRadioId: options?.removeSessionRadioId,
  };
}

export function addResolvedStationToSession(
  radio: Radio,
  addSessionRadio: (radio: Radio) => void
): { radio: Radio } {
  addSessionRadio(radio);
  return { radio };
}

export async function resolveRadioGardenStation(
  result: RadioGardenSearchResult,
  loadStream: RadioGardenResolveLoader,
  options?: { name?: string }
): Promise<ExternalStationResult<Radio>> {
  try {
    const resolved = await loadStream(result.channelId, result.url);
    if (!resolved.ok) {
      return resolved;
    }

    return {
      ok: true,
      data: createRadioGardenRadio(
        result,
        resolved.data.streamUrl,
        options?.name ?? result.title,
        resolved.data.format
      ),
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkflowError(error, {
        code: "RADIO_GARDEN_WORKFLOW_FAILED",
        message: "Failed to resolve station",
      }),
    };
  }
}

export async function resolvePlatformStation(
  url: string,
  loadPlatform: PlatformResolveLoader
): Promise<ExternalStationResult<Radio>> {
  try {
    const resolved = await loadPlatform(url.trim());
    if (!resolved.ok) {
      return resolved;
    }

    return {
      ok: true,
      data: createPlatformRadio(
        resolved.data.streamUrl,
        resolved.data.metadata,
        resolved.data.format
      ),
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkflowError(error, {
        code: "PLATFORM_STATION_WORKFLOW_FAILED",
        message: "Failed to resolve platform item",
      }),
    };
  }
}

function getRadioGardenSessionId(result: RadioGardenSearchResult): string {
  return `rg_${result.channelId}`;
}

function findRadioGardenSessionRadio(
  result: RadioGardenSearchResult,
  sessionRadios: Iterable<Radio>
): Radio | undefined {
  const sessionId = getRadioGardenSessionId(result);
  for (const radio of sessionRadios) {
    if (String(radio.id) === sessionId) {
      return radio;
    }
  }
}

function radioGardenUnavailableResult<T>(): ExternalStationResult<T> {
  return {
    ok: false,
    error: {
      code: "RADIO_GARDEN_RESOLVE_UNAVAILABLE",
      message: "Radio Garden resolution is unavailable here",
    },
  };
}

function platformUnavailableResult<T>(): ExternalStationResult<T> {
  return {
    ok: false,
    error: {
      code: "PLATFORM_RESOLVE_UNAVAILABLE",
      message: "Platform resolution is unavailable here",
    },
  };
}

export function createExternalStationResolutionWorkflow({
  adapters,
  collection,
  session,
}: ExternalStationResolutionWorkflowDependencies) {
  return {
    async resolveRadioGardenToSession(
      result: RadioGardenSearchResult,
      options?: { name?: string }
    ): Promise<ExternalStationResult<ResolvedStationData>> {
      if (!adapters.radioGarden) {
        return radioGardenUnavailableResult();
      }

      const resolved = await resolveRadioGardenStation(
        result,
        adapters.radioGarden.resolveStream,
        options
      );
      if (!resolved.ok) {
        return resolved;
      }

      session?.addSessionRadio(resolved.data);
      return { ok: true, data: { radio: resolved.data } };
    },

    async resolveRadioGardenToCollection(
      result: RadioGardenSearchResult,
      options?: { name?: string }
    ): Promise<ExternalStationResult<SavedStationData>> {
      const sessionRadio = session
        ? findRadioGardenSessionRadio(result, session.getSessionRadios())
        : undefined;
      if (sessionRadio && session) {
        return {
          ok: true,
          data: saveResolvedStationToCollection(
            sessionRadio,
            {
              ...collection,
              removeSessionRadio: session.removeSessionRadio,
            },
            { removeSessionRadioId: sessionRadio.id }
          ),
        };
      }

      if (!adapters.radioGarden) {
        return radioGardenUnavailableResult();
      }

      const resolved = await resolveRadioGardenStation(
        result,
        adapters.radioGarden.resolveStream,
        options
      );
      if (!resolved.ok) {
        return resolved;
      }

      return {
        ok: true,
        data: saveResolvedStationToCollection(resolved.data, collection),
      };
    },

    async resolvePlatformUrl(
      url: string
    ): Promise<ExternalStationResult<ResolvedStationData>> {
      if (!adapters.platform) {
        return platformUnavailableResult();
      }

      const result = await resolvePlatformStation(
        url,
        adapters.platform.resolve
      );
      if (!result.ok) {
        return result;
      }

      return { ok: true, data: { radio: result.data } };
    },

    saveRadioToCollection(
      radio: Radio,
      options?: { removeSessionRadioId?: string | number }
    ): SavedStationData {
      return saveResolvedStationToCollection(
        radio,
        session
          ? { ...collection, removeSessionRadio: session.removeSessionRadio }
          : collection,
        options
      );
    },
  };
}
