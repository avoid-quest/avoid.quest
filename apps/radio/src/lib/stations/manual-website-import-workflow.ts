import type { Radio } from "@/lib/audio";
import type { RadioRecord } from "@/lib/collections";
import type { RadioMetadata, ScrapedOption } from "@/lib/platform-types";
import { parseRadioMetadataFromDocument } from "@/lib/radio-scraper";
import {
  createImportedStationRadio,
  saveResolvedStationToCollection,
} from "./external-station-workflow";

export type ManualWebsiteImportError = {
  code: ManualWebsiteImportErrorCode;
  message: string;
};

export type ManualWebsiteImportErrorCode =
  | "INVALID_WEBSITE_URL"
  | "MISSING_REQUIRED_STATION_FIELDS"
  | "MISSING_WEBSITE_URL"
  | "WEBSITE_FETCH_FAILED"
  | "WEBSITE_PARSE_FAILED";

export type ManualWebsiteImportResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ManualWebsiteImportError };

export type ManualWebsiteImportDraft = {
  metadata: RadioMetadata;
  fields: ManualWebsiteImportFields;
};

export type ManualWebsiteImportFields = {
  description: string;
  logoUrl: string;
  name: string;
  streamUrl: string;
  websiteUrl: string;
};

type FetchWebsiteResult = {
  html: string;
};

type BrowserManualWebsiteImportDependencies = Pick<
  ManualWebsiteImportDependencies,
  "addSavedRadio" | "getSavedRadios"
>;

export type ManualWebsiteImportDependencies = {
  addSavedRadio: (radio: Omit<RadioRecord, "id">) => void;
  fetchWebsite: (websiteUrl: string) => Promise<FetchWebsiteResult>;
  getSavedRadios: () => Iterable<Pick<RadioRecord, "order">>;
  parseHtml: (html: string) => Document;
};

const CORS_PROXY = "https://api.allorigins.win/raw?url=";
const FETCH_TIMEOUT = 10_000;

export function validateManualWebsiteImportUrl(
  websiteUrl: string
): ManualWebsiteImportResult<string> {
  const trimmedUrl = websiteUrl.trim();
  if (!trimmedUrl) {
    return {
      ok: false,
      error: {
        code: "MISSING_WEBSITE_URL",
        message: "Please enter a URL",
      },
    };
  }

  try {
    new URL(trimmedUrl);
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_WEBSITE_URL",
        message: "Please enter a valid URL",
      },
    };
  }

  return { ok: true, data: trimmedUrl };
}

function getBestValue(options?: ScrapedOption[]): string {
  return options?.[0]?.value ?? "";
}

function createDraftFromMetadata(
  metadata: RadioMetadata,
  websiteUrl: string
): ManualWebsiteImportDraft {
  return {
    fields: {
      description: getBestValue(metadata.description),
      logoUrl: getBestValue(metadata.logoUrl),
      name: getBestValue(metadata.name),
      streamUrl: getBestValue(metadata.streamUrl),
      websiteUrl,
    },
    metadata,
  };
}

function createSafeFailure(
  code: ManualWebsiteImportErrorCode,
  fallbackMessage: string,
  error: unknown
): ManualWebsiteImportResult<never> {
  const message =
    error instanceof Error && error.message.trim()
      ? `${fallbackMessage}: ${error.message}`
      : fallbackMessage;

  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

function fetchWithTimeout(
  url: string,
  options: { timeout: number }
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    fetch(url, { signal: controller.signal })
      .then((response) => {
        clearTimeout(timeoutId);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function fetchWebsite(websiteUrl: string): Promise<FetchWebsiteResult> {
  const response = await fetchWithTimeout(
    `${CORS_PROXY}${encodeURIComponent(websiteUrl)}`,
    {
      timeout: FETCH_TIMEOUT,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  return { html: await response.text() };
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

export function createManualWebsiteImportWorkflow({
  addSavedRadio,
  fetchWebsite,
  getSavedRadios,
  parseHtml,
}: ManualWebsiteImportDependencies) {
  return {
    async fetchDefaults(
      websiteUrl: string
    ): Promise<ManualWebsiteImportResult<ManualWebsiteImportDraft>> {
      const validatedUrl = validateManualWebsiteImportUrl(websiteUrl);
      if (!validatedUrl.ok) {
        return validatedUrl;
      }

      let fetched: FetchWebsiteResult;
      try {
        fetched = await fetchWebsite(validatedUrl.data);
      } catch (error) {
        return createSafeFailure(
          "WEBSITE_FETCH_FAILED",
          "Failed to fetch website data",
          error
        );
      }

      let metadata: RadioMetadata;
      try {
        metadata = parseRadioMetadataFromDocument(
          parseHtml(fetched.html),
          validatedUrl.data
        );
      } catch (error) {
        return createSafeFailure(
          "WEBSITE_PARSE_FAILED",
          "Failed to parse website data",
          error
        );
      }

      return {
        ok: true,
        data: createDraftFromMetadata(metadata, validatedUrl.data),
      };
    },

    saveDraft(
      fields: ManualWebsiteImportFields
    ): ManualWebsiteImportResult<{ order: number; radio: Radio }> {
      if (!(fields.name.trim() && fields.streamUrl.trim())) {
        return {
          ok: false,
          error: {
            code: "MISSING_REQUIRED_STATION_FIELDS",
            message: "Name and Stream URL are required",
          },
        };
      }

      const saved = saveResolvedStationToCollection(
        createImportedStationRadio(fields),
        {
          addSavedRadio,
          getSavedRadios,
        }
      );

      return {
        ok: true,
        data: saved,
      };
    },

    validateWebsiteUrl: validateManualWebsiteImportUrl,
  };
}

export function createBrowserManualWebsiteImportWorkflow(
  dependencies: BrowserManualWebsiteImportDependencies
) {
  return createManualWebsiteImportWorkflow({
    ...dependencies,
    fetchWebsite,
    parseHtml,
  });
}
