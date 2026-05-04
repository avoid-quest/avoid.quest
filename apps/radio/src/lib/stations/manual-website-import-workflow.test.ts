import { describe, expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { createManualWebsiteImportWorkflow } from "./manual-website-import-workflow";

function parseHtml(html: string): Document {
  return new JSDOM(html).window.document;
}

describe("createManualWebsiteImportWorkflow", () => {
  test("rejects empty and invalid website URLs before fetching", async () => {
    const fetches: string[] = [];
    const workflow = createManualWebsiteImportWorkflow({
      addSavedRadio: () => undefined,
      fetchWebsite: (url) => {
        fetches.push(url);
        return Promise.resolve({ html: "" });
      },
      getSavedRadios: () => [],
      parseHtml: () => {
        throw new Error("parse should not run");
      },
    });

    await expect(workflow.fetchDefaults("   ")).resolves.toEqual({
      ok: false,
      error: {
        code: "MISSING_WEBSITE_URL",
        message: "Please enter a URL",
      },
    });
    await expect(workflow.fetchDefaults("not a url")).resolves.toEqual({
      ok: false,
      error: {
        code: "INVALID_WEBSITE_URL",
        message: "Please enter a valid URL",
      },
    });
    expect(fetches).toEqual([]);
  });

  test("fetches and ranks website metadata into editable defaults", async () => {
    const workflow = createManualWebsiteImportWorkflow({
      addSavedRadio: () => undefined,
      fetchWebsite: async () => ({
        html: `
          <html>
            <head>
              <title>Lower Confidence Radio</title>
              <meta property="og:title" content="Example FM" />
              <meta property="og:image" content="/social.png" />
              <meta property="og:description" content="Independent radio from Example City." />
            </head>
            <body>
              <h1>Heading Radio</h1>
              <audio title="Main stream" src="/live.mp3"></audio>
              <a href="https://streams.example/backup.m3u8">Backup stream</a>
              <img class="site-logo" src="/logo.png" alt="Example logo" />
            </body>
          </html>
        `,
      }),
      getSavedRadios: () => [],
      parseHtml,
    });

    const result = await workflow.fetchDefaults(" https://radio.example ");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.fields).toEqual({
        description: "Independent radio from Example City.",
        logoUrl: "https://radio.example/logo.png",
        name: "Example FM",
        streamUrl: "https://radio.example/live.mp3",
        websiteUrl: "https://radio.example",
      });
      expect(
        result.data.metadata.streamUrl?.map((option) => option.value)
      ).toEqual([
        "https://radio.example/live.mp3",
        "https://streams.example/backup.m3u8",
      ]);
    }
  });

  test("returns a safe fetch failure without saving partial records", async () => {
    const saved: unknown[] = [];
    const workflow = createManualWebsiteImportWorkflow({
      addSavedRadio: (radio) => saved.push(radio),
      fetchWebsite: () => Promise.reject(new Error("Network unavailable")),
      getSavedRadios: () => [{ order: 3 }],
      parseHtml,
    });

    const result = await workflow.fetchDefaults("https://radio.example");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "WEBSITE_FETCH_FAILED",
        message: "Failed to fetch website data: Network unavailable",
      },
    });
    expect(saved).toEqual([]);
  });

  test("returns a safe parse failure without saving partial records", async () => {
    const saved: unknown[] = [];
    const workflow = createManualWebsiteImportWorkflow({
      addSavedRadio: (radio) => saved.push(radio),
      fetchWebsite: async () => ({ html: "<html>" }),
      getSavedRadios: () => [{ order: 3 }],
      parseHtml: () => {
        throw new Error("Malformed HTML");
      },
    });

    const result = await workflow.fetchDefaults("https://radio.example");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "WEBSITE_PARSE_FAILED",
        message: "Failed to parse website data: Malformed HTML",
      },
    });
    expect(saved).toEqual([]);
  });

  test("rejects saved drafts without required name and stream URL", () => {
    const saved: unknown[] = [];
    const workflow = createManualWebsiteImportWorkflow({
      addSavedRadio: (radio) => saved.push(radio),
      fetchWebsite: async () => ({ html: "" }),
      getSavedRadios: () => [{ order: 3 }],
      parseHtml,
    });

    expect(
      workflow.saveDraft({
        description: "Description",
        logoUrl: "https://radio.example/logo.png",
        name: " ",
        streamUrl: "https://streams.example/live.mp3",
        websiteUrl: "https://radio.example",
      })
    ).toEqual({
      ok: false,
      error: {
        code: "MISSING_REQUIRED_STATION_FIELDS",
        message: "Name and Stream URL are required",
      },
    });
    expect(
      workflow.saveDraft({
        description: "Description",
        logoUrl: "https://radio.example/logo.png",
        name: "Example FM",
        streamUrl: " ",
        websiteUrl: "https://radio.example",
      })
    ).toEqual({
      ok: false,
      error: {
        code: "MISSING_REQUIRED_STATION_FIELDS",
        message: "Name and Stream URL are required",
      },
    });
    expect(saved).toEqual([]);
  });

  test("saves edited defaults as the normalized station record with next order", () => {
    const saved: unknown[] = [];
    const workflow = createManualWebsiteImportWorkflow({
      addSavedRadio: (radio) => saved.push(radio),
      fetchWebsite: async () => ({ html: "" }),
      getSavedRadios: () => [{ order: 2 }, { order: 9 }],
      parseHtml,
    });

    const result = workflow.saveDraft({
      description: " Edited station description ",
      logoUrl: " https://radio.example/edited-logo.png ",
      name: " Edited FM ",
      streamUrl: " https://streams.example/edited.mp3 ",
      websiteUrl: " https://radio.example ",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        order: 10,
        radio: {
          description: "Edited station description",
          enabled: true,
          isSystem: false,
          logoUrl: "https://radio.example/edited-logo.png",
          name: "Edited FM",
          streamUrl: "https://streams.example/edited.mp3",
          websiteUrl: "https://radio.example",
        },
      },
    });
    expect(saved).toEqual([
      {
        countryTitle: undefined,
        description: "Edited station description",
        enabled: true,
        isSystem: false,
        logoUrl: "https://radio.example/edited-logo.png",
        name: "Edited FM",
        order: 10,
        placeTitle: undefined,
        platformMetadata: undefined,
        streamUrl: "https://streams.example/edited.mp3",
        websiteUrl: "https://radio.example",
      },
    ]);
  });
});
