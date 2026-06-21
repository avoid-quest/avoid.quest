import { describe, expect, mock, test } from "bun:test";
import {
  fetchWithValidatedRedirectResult,
  fetchWithValidatedRedirects,
  type UrlValidationResult,
  ValidatedRedirectError,
  type ValidatedRedirectFailure,
} from "./validated-redirects";

type TestFetchUrlFailure = "invalid-url" | "invalid-domain";

const TEST_REDIRECT_FAILURE_MESSAGES = {
  "invalid-url": "Invalid URL",
  "invalid-domain": "Invalid domain",
  "missing-location": "Missing Location",
  "too-many-redirects": "Too many redirects",
} as const satisfies Record<
  ValidatedRedirectFailure<TestFetchUrlFailure>,
  string
>;

function validateExampleUrl(
  url: string
): UrlValidationResult<TestFetchUrlFailure> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (parsed.hostname !== "example.test") {
    return { ok: false, reason: "invalid-domain" };
  }

  return { ok: true, url };
}

describe("fetchWithValidatedRedirects", () => {
  test("rejects invalid initial URLs before fetching", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("Invalid initial URLs should not be fetched");
    });

    await expect(
      fetchWithValidatedRedirectResult({
        fetchImpl,
        invalidUrlReason: "invalid-url",
        url: "",
        validateUrl: validateExampleUrl,
      })
    ).resolves.toEqual({
      failure: {
        reason: "invalid-url",
        url: "",
      },
      ok: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("follows validated redirects and returns the final URL", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      requestedUrls.push(url);

      if (url === "https://example.test/start") {
        return new Response(null, {
          headers: { Location: "/final" },
          status: 302,
        });
      }

      return new Response("ok");
    });

    const result = await fetchWithValidatedRedirects({
      fetchImpl,
      invalidUrlReason: "invalid-url",
      url: "https://example.test/start",
      validateUrl: validateExampleUrl,
    });

    expect(result.resolvedUrl).toBe("https://example.test/final");
    expect("ok" in result).toBe(false);
    expect(requestedUrls).toEqual([
      "https://example.test/start",
      "https://example.test/final",
    ]);
  });

  test("rejects invalid redirect targets before fetching them", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      requestedUrls.push(url);
      return Response.redirect("https://internal.test/final", 302);
    });

    await expect(
      fetchWithValidatedRedirects({
        fetchImpl,
        invalidUrlReason: "invalid-url",
        url: "https://example.test/start",
        validateUrl: validateExampleUrl,
      })
    ).rejects.toMatchObject({
      reason: "invalid-domain",
      url: "https://internal.test/final",
    });
    expect(requestedUrls).toEqual(["https://example.test/start"]);
  });

  test("returns typed failure results for exhaustive caller mapping", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return Response.redirect("https://internal.test/final", 302);
    });

    const result = await fetchWithValidatedRedirectResult({
      fetchImpl,
      invalidUrlReason: "invalid-url",
      url: "https://example.test/start",
      validateUrl: validateExampleUrl,
    });

    expect(result).toEqual({
      failure: {
        reason: "invalid-domain",
        url: "https://internal.test/final",
      },
      ok: false,
    });

    if (!result.ok) {
      expect(TEST_REDIRECT_FAILURE_MESSAGES[result.failure.reason]).toBe(
        "Invalid domain"
      );
      return;
    }

    throw new Error("Expected typed redirect failure result");
  });

  test("throws a structured failure at the redirect hop limit", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return Response.redirect("https://example.test/next", 302);
    });

    try {
      await fetchWithValidatedRedirects({
        fetchImpl,
        invalidUrlReason: "invalid-url",
        maxRedirects: 0,
        url: "https://example.test/start",
        validateUrl: validateExampleUrl,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidatedRedirectError);
      expect(error).toMatchObject({
        reason: "too-many-redirects",
        url: "https://example.test/start",
      });
      return;
    }

    throw new Error("Expected redirect hop limit failure");
  });
});
