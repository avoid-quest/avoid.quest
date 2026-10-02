import type { RadioMetadata, ScrapedOption } from "@/lib/platform-types";
import { parseRadioMetadataFromDocument } from "@/lib/radio-scraper";

export type ManualWebsiteImportError = {
  code: ManualWebsiteImportErrorCode;
  message: string;
};

export type ManualWebsiteImportErrorCode =
  | "INVALID_WEBSITE_URL"
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

export type ManualWebsiteImportDependencies = {
  fetchWebsite: (websiteUrl: string) => Promise<FetchWebsiteResult>;
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
      error: {
        code: "MISSING_WEBSITE_URL",
        message: "Enter a URL",
      },
      ok: false,
    };
  }

  if (!URL.canParse(trimmedUrl)) {
    return {
      error: {
        code: "INVALID_WEBSITE_URL",
        message: "Enter a valid URL",
      },
      ok: false,
    };
  }

  return { data: trimmedUrl, ok: true };
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
  message: string
): ManualWebsiteImportResult<never> {
  return {
    error: {
      code,
      message,
    },
    ok: false,
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
  fetchWebsite: fetchWebsiteContent,
  parseHtml: parseWebsiteHtml,
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
        fetched = await fetchWebsiteContent(validatedUrl.data);
      } catch {
        return createSafeFailure(
          "WEBSITE_FETCH_FAILED",
          "Couldn't reach that site"
        );
      }

      let metadata: RadioMetadata;
      try {
        metadata = parseRadioMetadataFromDocument(
          parseWebsiteHtml(fetched.html),
          validatedUrl.data
        );
      } catch {
        return createSafeFailure(
          "WEBSITE_PARSE_FAILED",
          "Couldn't read that site"
        );
      }

      return {
        data: createDraftFromMetadata(metadata, validatedUrl.data),
        ok: true,
      };
    },

    validateWebsiteUrl: validateManualWebsiteImportUrl,
  };
}

export function createBrowserManualWebsiteImportWorkflow() {
  return createManualWebsiteImportWorkflow({
    fetchWebsite,
    parseHtml,
  });
}
