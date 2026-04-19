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

type RadioGardenResolveLoader = (
  channelId: string
) => Promise<ExternalStationResult<{ streamUrl: string }>>;

type PlatformResolveLoader = (
  url: string
) => Promise<
  ExternalStationResult<{ metadata: PlatformMetadata; streamUrl: string }>
>;

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

export function createRadioGardenRadio(
  result: RadioGardenSearchResult,
  streamUrl: string,
  name = result.title
): Radio {
  return {
    id: `rg_${result.channelId}`,
    name,
    streamUrl,
    description: result.subtitle,
    placeTitle: result.placeTitle,
    countryTitle: result.countryTitle,
    websiteUrl: result.website,
    enabled: true,
    isSystem: false,
    platformMetadata: {
      platform: "radiogarden",
      itemType: "channel",
      url: result.url,
      channelId: result.channelId,
      name,
      subtitle: result.subtitle,
      placeTitle: result.placeTitle,
      countryTitle: result.countryTitle,
      website: result.website,
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
    name: radio.name,
    streamUrl: radio.streamUrl,
    logoUrl: radio.logoUrl,
    description: radio.description,
    websiteUrl: radio.websiteUrl,
    placeTitle: radio.placeTitle,
    countryTitle: radio.countryTitle,
    order,
    enabled: true,
    isSystem: false,
    platformMetadata: radio.platformMetadata,
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
    const resolved = await loadStream(result.channelId);
    if (!resolved.ok) {
      return resolved;
    }

    return {
      ok: true,
      data: createRadioGardenRadio(
        result,
        resolved.data.streamUrl,
        options?.name ?? result.title
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
    const resolved = await loadPlatform(url);
    if (!resolved.ok) {
      return resolved;
    }

    return {
      ok: true,
      data: createPlatformRadio(
        resolved.data.streamUrl,
        resolved.data.metadata
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
