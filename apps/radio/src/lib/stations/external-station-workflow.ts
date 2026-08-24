import type { RadioBrowserStation } from "@avoid.quest/platforms/radiobrowser";
import type { Radio } from "@/lib/audio";
import { type RadioRecord, radiosCollection } from "@/lib/collections";
import {
  addSessionRadio,
  getSessionRadios,
  removeSessionRadio,
} from "@/lib/collections/session-radios";
import { createPlatformRadio } from "@/lib/external-url/utils";
import type {
  PlatformMetadata,
  RadioGardenSearchResult,
} from "@/lib/platform-types";
import { generateId } from "@/lib/types";

export type ExternalStationError = {
  code: string;
  message: string;
};

export type ExternalStationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ExternalStationError };

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
  radioGarden?: {
    resolveStream: RadioGardenResolveLoader;
  };
};

export type StationFields = {
  description?: string;
  logoUrl?: string;
  name: string;
  streamUrl: string;
  websiteUrl?: string;
};

export type StationCandidate =
  | {
      fields: StationFields;
      origin: "manual" | "website";
    }
  | {
      origin: "discovery";
      radio: Radio;
    }
  | {
      name?: string;
      origin: "radio-garden";
      resolved?: {
        format?: Radio["streamFormat"];
        streamUrl: string;
      };
      result: RadioGardenSearchResult;
    }
  | {
      origin: "radio-browser";
      station: RadioBrowserStation;
    };

export type StationIntakeDependencies = {
  adapters: ExternalStationResolutionAdapters;
  saved: {
    add: (radio: Omit<RadioRecord, "id">) => void;
    getAll: () => Iterable<RadioRecord>;
    update: (
      id: string,
      updates: Partial<Omit<RadioRecord, "id" | "order">>
    ) => void;
  };
  session: {
    add: (radio: Radio) => void;
    getAll: () => Iterable<Radio>;
    remove: (id: string | number) => void;
  };
};

export type StationIntakeResult = ExternalStationResult<{
  order?: number;
  radio: Radio;
  sessionCleanupPending?: true;
}>;

type SavedStationUpdates = Partial<Omit<RadioRecord, "id" | "order">>;

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
const TRAILING_SLASH_PATTERN = /\/$/;

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

function normalizeRadio(radio: Radio): Radio {
  const platformMetadata = normalizePlatformMetadata(radio.platformMetadata);
  const logoUrl = normalizeOptionalString(radio.logoUrl);
  const description = normalizeOptionalString(radio.description);
  const websiteUrl = normalizeOptionalString(radio.websiteUrl);
  const placeTitle = normalizeOptionalString(radio.placeTitle);
  const countryTitle = normalizeOptionalString(radio.countryTitle);
  let id = radio.id;
  if (platformMetadata?.platform === "radio-browser") {
    id = `rb_${platformMetadata.stationUuid}`;
  } else if (platformMetadata?.platform === "radiogarden") {
    id = `rg_${platformMetadata.channelId}`;
  }

  return {
    ...(id === undefined ? {} : { id }),
    name: normalizeRequiredString(radio.name),
    streamUrl: normalizeRequiredString(radio.streamUrl),
    ...(radio.streamFormat ? { streamFormat: radio.streamFormat } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(description ? { description } : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
    ...(placeTitle ? { placeTitle } : {}),
    ...(countryTitle ? { countryTitle } : {}),
    enabled: true,
    isSystem: false,
    ...(platformMetadata ? { platformMetadata } : {}),
    ...(radio.metadataConfig ? { metadataConfig: radio.metadataConfig } : {}),
  };
}

function normalizeStreamIdentity(streamUrl: string): string {
  try {
    const url = new URL(streamUrl);
    url.hash = "";
    return url.toString().replace(TRAILING_SLASH_PATTERN, "");
  } catch {
    return "";
  }
}

function getProviderIdentity(radio: Radio): string | undefined {
  const metadata = radio.platformMetadata;
  if (metadata?.platform === "radio-browser") {
    return `radio-browser:${metadata.stationUuid}`;
  }
  if (metadata?.platform === "radiogarden") {
    return `radiogarden:${metadata.channelId}`;
  }
}

function getSavedStationUpdates(
  existing: RadioRecord,
  incoming: Radio
): SavedStationUpdates {
  const providerIdentity = getProviderIdentity(incoming);
  const refreshProvider =
    providerIdentity !== undefined &&
    providerIdentity === getProviderIdentity(existing);
  return {
    ...(existing.enabled ? {} : { enabled: true }),
    ...(refreshProvider
      ? {
          platformMetadata: incoming.platformMetadata,
          streamFormat: incoming.streamFormat,
          streamUrl: incoming.streamUrl,
        }
      : {}),
  };
}

function getStationIdentityKeys(radio: Radio): Set<string> {
  const keys = new Set<string>();
  const providerIdentity = getProviderIdentity(radio);
  if (providerIdentity) {
    keys.add(providerIdentity);
  }
  const streamIdentity = normalizeStreamIdentity(radio.streamUrl);
  if (streamIdentity) {
    keys.add(`stream:${streamIdentity}`);
  }
  return keys;
}

function findStationsByIdentity<T extends Radio>(
  stations: Iterable<T>,
  radio: Radio
): T[] {
  const identityKeys = getStationIdentityKeys(radio);
  const matches: T[] = [];
  for (const station of stations) {
    for (const key of getStationIdentityKeys(station)) {
      if (identityKeys.has(key)) {
        matches.push(station);
        break;
      }
    }
  }
  return matches;
}

function findStationByIdentity<T extends Radio>(
  stations: Iterable<T>,
  radio: Radio
): T | undefined {
  return findStationsByIdentity(stations, radio)[0];
}

function reuseRadioGardenSession(
  candidate: StationCandidate,
  sessions: Iterable<Radio>
): StationCandidate {
  if (candidate.origin !== "radio-garden" || candidate.resolved) {
    return candidate;
  }
  const session = findStationByIdentity(
    sessions,
    createRadioGardenRadio(
      candidate.result,
      "",
      candidate.name ?? candidate.result.title
    )
  );
  if (!(session && normalizeStreamIdentity(session.streamUrl))) {
    return candidate;
  }
  return {
    ...candidate,
    resolved: {
      ...(session.streamFormat ? { format: session.streamFormat } : {}),
      streamUrl: session.streamUrl,
    },
  };
}

function validatePreparedRadio(radio: Radio): ExternalStationResult<Radio> {
  if (!(radio.name && radio.streamUrl)) {
    return {
      error: {
        code: "INVALID_STATION_CANDIDATE",
        message: "Name and Stream URL are required",
      },
      ok: false,
    };
  }

  try {
    new URL(radio.streamUrl);
  } catch {
    return {
      error: {
        code: "INVALID_STATION_CANDIDATE",
        message: "Stream URL must be a valid URL",
      },
      ok: false,
    };
  }

  return { data: radio, ok: true };
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
  const countryTitle = normalizeOptionalString(station.country);
  const state = normalizeOptionalString(station.state);
  const placeTitle =
    state?.toLocaleLowerCase() === countryTitle?.toLocaleLowerCase()
      ? undefined
      : state;

  return {
    id: `rb_${stationUuid}`,
    name: normalizeRequiredString(station.name),
    streamUrl: resolvedUrl || canonicalUrl,
    logoUrl: normalizeOptionalString(station.favicon),
    description: normalizeOptionalString(station.tags.join(", ")),
    websiteUrl: normalizeOptionalString(station.homepage),
    placeTitle,
    countryTitle,
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

function createImportedStationRadio(input: {
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

function getNextSavedRadioOrder(
  radios: Iterable<Pick<RadioRecord, "order">>
): number {
  let maxOrder = 0;
  for (const radio of radios) {
    maxOrder = Math.max(maxOrder, radio.order || 0);
  }
  return maxOrder + 1;
}

function toSavedRadioRecord(
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

async function resolveRadioGardenStation(
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

function radioGardenUnavailableResult<T>(): ExternalStationResult<T> {
  return {
    ok: false,
    error: {
      code: "RADIO_GARDEN_RESOLVE_UNAVAILABLE",
      message: "Radio Garden resolution is unavailable here",
    },
  };
}

function resolveStationCandidate(
  candidate: StationCandidate,
  adapters: ExternalStationResolutionAdapters
): ExternalStationResult<Radio> | Promise<ExternalStationResult<Radio>> {
  if (candidate.origin === "radio-garden") {
    if (!(candidate.result.channelId.trim() && candidate.result.url.trim())) {
      return {
        error: {
          code: "INVALID_STATION_CANDIDATE",
          message: "Radio Garden identity is required",
        },
        ok: false,
      };
    }
    if (candidate.resolved) {
      return {
        data: createRadioGardenRadio(
          candidate.result,
          candidate.resolved.streamUrl,
          candidate.name ?? candidate.result.title,
          candidate.resolved.format
        ),
        ok: true,
      };
    }
    if (!adapters.radioGarden) {
      return radioGardenUnavailableResult();
    }
    return resolveRadioGardenStation(
      candidate.result,
      adapters.radioGarden.resolveStream,
      candidate.name === undefined ? undefined : { name: candidate.name }
    );
  }

  if (candidate.origin === "radio-browser") {
    if (!candidate.station.stationUuid.trim()) {
      return {
        error: {
          code: "INVALID_STATION_CANDIDATE",
          message: "Radio Browser identity is required",
        },
        ok: false,
      };
    }
    return { data: createRadioBrowserRadio(candidate.station), ok: true };
  }

  return {
    data:
      candidate.origin === "discovery"
        ? candidate.radio
        : createImportedStationRadio(candidate.fields),
    ok: true,
  };
}

export function createStationIntake(dependencies: StationIntakeDependencies) {
  const prepare = async (
    candidate: StationCandidate
  ): Promise<StationIntakeResult> => {
    const resolved = await resolveStationCandidate(
      candidate,
      dependencies.adapters
    );
    if (!resolved.ok) {
      return resolved;
    }
    const radio = normalizeRadio(resolved.data);
    const validated = validatePreparedRadio(radio);
    return validated.ok
      ? { data: { radio: validated.data }, ok: true }
      : validated;
  };

  const tryCleanupSessions = (
    sessions: Iterable<Radio>
  ): { sessionCleanupPending?: true } => {
    let sessionCleanupPending = false;
    for (const session of sessions) {
      if (session.id !== undefined) {
        try {
          dependencies.session.remove(session.id);
        } catch {
          sessionCleanupPending = true;
        }
      }
    }
    return sessionCleanupPending ? { sessionCleanupPending: true } : {};
  };

  return {
    async createSession(
      candidate: StationCandidate
    ): Promise<StationIntakeResult> {
      const prepared = await prepare(candidate);
      if (!prepared.ok) {
        return prepared;
      }
      const staleSessions = findStationsByIdentity(
        dependencies.session.getAll(),
        prepared.data.radio
      ).filter((session) => session.id !== prepared.data.radio.id);
      try {
        dependencies.session.add(prepared.data.radio);
      } catch (error) {
        return {
          error: normalizeWorkflowError(error, {
            code: "SESSION_STATION_SAVE_FAILED",
            message: "Failed to create Session station",
          }),
          ok: false,
        };
      }
      return {
        data: {
          ...prepared.data,
          ...tryCleanupSessions(staleSessions),
        },
        ok: true,
      };
    },

    prepare,

    async save(candidate: StationCandidate): Promise<StationIntakeResult> {
      const prepared = await prepare(
        reuseRadioGardenSession(candidate, dependencies.session.getAll())
      );
      if (!prepared.ok) {
        return prepared;
      }
      const matchingSessions = findStationsByIdentity(
        dependencies.session.getAll(),
        prepared.data.radio
      );
      const existingSession = matchingSessions[0];
      const radio =
        existingSession && candidate.origin === "discovery"
          ? normalizeRadio(existingSession)
          : prepared.data.radio;
      const existingSaved = findStationByIdentity(
        dependencies.saved.getAll(),
        radio
      );
      if (existingSaved) {
        const updates = getSavedStationUpdates(existingSaved, radio);
        if (Object.keys(updates).length > 0) {
          try {
            dependencies.saved.update(existingSaved.id, updates);
          } catch (error) {
            return {
              error: normalizeWorkflowError(error, {
                code: "SAVED_STATION_SAVE_FAILED",
                message: "Failed to save Station",
              }),
              ok: false,
            };
          }
        }
        return {
          data: {
            order: existingSaved.order,
            radio: { ...existingSaved, ...updates },
            ...tryCleanupSessions(matchingSessions),
          },
          ok: true,
        };
      }
      const order = getNextSavedRadioOrder(dependencies.saved.getAll());
      try {
        dependencies.saved.add(toSavedRadioRecord(radio, order));
      } catch (error) {
        return {
          error: normalizeWorkflowError(error, {
            code: "SAVED_STATION_SAVE_FAILED",
            message: "Failed to save Station",
          }),
          ok: false,
        };
      }
      return {
        data: { order, radio, ...tryCleanupSessions(matchingSessions) },
        ok: true,
      };
    },
  };
}

export function createBrowserStationIntake(
  adapters: ExternalStationResolutionAdapters = {}
) {
  return createStationIntake({
    adapters,
    saved: {
      add: (radio) => radiosCollection.insert({ id: generateId(), ...radio }),
      getAll: () => radiosCollection.state.values(),
      update: (id, updates) =>
        radiosCollection.update(id, (draft) => {
          Object.assign(draft, updates);
        }),
    },
    session: {
      add: addSessionRadio,
      getAll: getSessionRadios,
      remove: removeSessionRadio,
    },
  });
}

export const stationIntake = createBrowserStationIntake();
