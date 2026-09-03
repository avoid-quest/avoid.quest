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
      fetchWebsite: (url) => {
        fetches.push(url);
        return Promise.resolve({ html: "" });
      },
      parseHtml: () => {
        throw new Error("parse should not run");
      },
    });

    await expect(workflow.fetchDefaults("   ")).resolves.toEqual({
      error: {
        code: "MISSING_WEBSITE_URL",
        message: "Please enter a URL",
      },
      ok: false,
    });
    await expect(workflow.fetchDefaults("not a url")).resolves.toEqual({
      error: {
        code: "INVALID_WEBSITE_URL",
        message: "Please enter a valid URL",
      },
      ok: false,
    });
    expect(fetches).toEqual([]);
  });

  test("fetches and ranks website metadata into editable defaults", async () => {
    const workflow = createManualWebsiteImportWorkflow({
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

  test("returns a safe website fetch failure", async () => {
    const workflow = createManualWebsiteImportWorkflow({
      fetchWebsite: () => Promise.reject(new Error("Network unavailable")),
      parseHtml,
    });

    const result = await workflow.fetchDefaults("https://radio.example");

    expect(result).toEqual({
      error: {
        code: "WEBSITE_FETCH_FAILED",
        message: "Failed to fetch website data: Network unavailable",
      },
      ok: false,
    });
  });

  test("returns a safe website parse failure", async () => {
    const workflow = createManualWebsiteImportWorkflow({
      fetchWebsite: async () => ({ html: "<html>" }),
      parseHtml: () => {
        throw new Error("Malformed HTML");
      },
    });

    const result = await workflow.fetchDefaults("https://radio.example");

    expect(result).toEqual({
      error: {
        code: "WEBSITE_PARSE_FAILED",
        message: "Failed to parse website data: Malformed HTML",
      },
      ok: false,
    });
  });
});
