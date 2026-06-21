import { describe, expect, mock, test } from "bun:test";
import type { AppError, AppErrorInit } from "@avoid.quest/error";
import type {
  FetchLike,
  UrlValidationResult,
  ValidatedRedirectFailure,
} from "@avoid.quest/platforms/redirects";
import {
  type CdnProxyWorkflowContext,
  createCdnProxyRequestWorkflow,
} from "./cdn-proxy-workflow";

type TestFailure = "required" | "invalid-url" | "invalid-domain";
type TestRedirectFailure = ValidatedRedirectFailure<TestFailure>;
type TestAuth = {
  ip?: string;
  sessionId: string;
};

const TEST_URL_FAILURE_ERRORS = {
  required: {
    code: "TEST_URL_REQUIRED",
    safeMessage: "URL parameter is required",
    category: "validation",
    expected: true,
    status: 400,
  },
  "invalid-url": {
    code: "TEST_INVALID_URL",
    safeMessage: "Invalid URL",
    category: "validation",
    expected: true,
    status: 400,
  },
  "invalid-domain": {
    code: "TEST_INVALID_DOMAIN",
    safeMessage: "Invalid domain",
    category: "security",
    expected: true,
    status: 400,
  },
} as const satisfies Record<TestFailure, AppErrorInit>;

const TEST_REDIRECT_FAILURE_ERRORS = {
  required: TEST_URL_FAILURE_ERRORS["invalid-url"],
  "invalid-url": TEST_URL_FAILURE_ERRORS["invalid-url"],
  "invalid-domain": TEST_URL_FAILURE_ERRORS["invalid-domain"],
  "missing-location": {
    code: "TEST_REDIRECT_LOCATION_MISSING",
    safeMessage: "Redirect location missing",
    category: "dependency",
    expected: false,
    status: 502,
  },
  "too-many-redirects": {
    code: "TEST_TOO_MANY_REDIRECTS",
    safeMessage: "Too many redirects",
    category: "dependency",
    expected: false,
    status: 502,
  },
} as const satisfies Record<TestRedirectFailure, AppErrorInit>;

function createTestPolicy() {
  return {
    errorHeaders(request: Request) {
      return {
        "Access-Control-Allow-Origin": new URL(request.url).origin,
      };
    },
    problem(error: AppError, origin: string, requestId: string) {
      return Response.json(
        {
          code: error.code,
          message: error.safeMessage,
          requestId,
          status: error.status,
        },
        {
          status: error.status,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "x-request-id": requestId,
          },
        }
      );
    },
  };
}

function validateTestUrl(
  urlParam: string | null
): UrlValidationResult<TestFailure> {
  if (!urlParam) {
    return { ok: false, reason: "required" };
  }

  if (!urlParam.startsWith("https://cdn.example/")) {
    return { ok: false, reason: "invalid-domain" };
  }

  return { ok: true, url: urlParam };
}

function createWorkflow({
  fetchImpl,
  fetchTimeoutMs,
  maxResponseSize,
  onUrlValidationFailure,
}: {
  fetchImpl?: FetchLike;
  fetchTimeoutMs?: number;
  maxResponseSize?: number;
  onUrlValidationFailure?: (details: {
    context: CdnProxyWorkflowContext<TestAuth>;
    reason: TestFailure;
    urlParam: string | null;
  }) => void;
} = {}) {
  return createCdnProxyRequestWorkflow<TestFailure, TestAuth>({
    createUpstreamHeaders: (request) => ({
      Range: request.headers.get("range") || "",
      Referer: "https://example.com/",
    }),
    fetchFailedError: {
      code: "TEST_FETCH_FAILED",
      safeMessage: "Failed to fetch stream",
      category: "network",
      expected: false,
      status: 500,
    },
    fetchImpl,
    fetchTimeoutMs,
    invalidUrlReason: "invalid-url",
    maxResponseSize,
    onUrlValidationFailure,
    operation: "test-proxy.fetch",
    proxyPolicy: createTestPolicy(),
    redirectFailureErrors: TEST_REDIRECT_FAILURE_ERRORS,
    responseTooLargeError: {
      code: "TEST_RESPONSE_TOO_LARGE",
      safeMessage: "Response too large",
      category: "validation",
      expected: true,
      status: 413,
    },
    timeoutError: {
      code: "TEST_TIMEOUT",
      safeMessage: "Request timeout",
      category: "network",
      expected: true,
      status: 408,
    },
    upstreamError: (response) => ({
      code: "TEST_UPSTREAM_ERROR",
      safeMessage: `Failed to fetch stream: ${response.statusText}`,
      category: "dependency",
      expected: false,
      status: response.status,
    }),
    urlFailureErrors: TEST_URL_FAILURE_ERRORS,
    validateUrl: validateTestUrl,
  });
}

describe("createCdnProxyRequestWorkflow", () => {
  test("runs the validation failure hook before returning a problem response", async () => {
    const validationFailures: Array<{
      reason: TestFailure;
      sessionId: string;
      urlParam: string | null;
    }> = [];
    const workflow = createWorkflow({
      onUrlValidationFailure: ({ context, reason, urlParam }) => {
        validationFailures.push({
          reason,
          sessionId: context.auth.sessionId,
          urlParam,
        });
      },
    });

    const response = await workflow.handle({
      auth: { ip: "203.0.113.10", sessionId: "sess_test" },
      origin: "https://radio.test",
      request: new Request(
        "https://radio.test/api/test-proxy?url=http%3A%2F%2F127.0.0.1%2Fsecret.mp3"
      ),
      requestId: "req_validation",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "TEST_INVALID_DOMAIN",
      message: "Invalid domain",
      requestId: "req_validation",
      status: 400,
    });
    expect(validationFailures).toEqual([
      {
        reason: "invalid-domain",
        sessionId: "sess_test",
        urlParam: "http://127.0.0.1/secret.mp3",
      },
    ]);
  });

  test("rejects upstream responses above the configured max size", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      return new Response("oversized", {
        headers: {
          "Content-Length": "6",
          "Content-Type": "audio/mpeg",
        },
      });
    });
    const workflow = createWorkflow({ fetchImpl, maxResponseSize: 5 });

    const response = await workflow.fetchStream(
      "https://cdn.example/track.mp3",
      {
        origin: "https://radio.test",
        request: new Request("https://radio.test/api/test-proxy"),
        requestId: "req_size",
      }
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: "TEST_RESPONSE_TOO_LARGE",
      message: "Response too large",
      requestId: "req_size",
      status: 413,
    });
  });

  test("maps validated redirect failures to the configured response", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      requestedUrls.push(url);
      return Response.redirect("https://internal.example/track.mp3", 302);
    });
    const workflow = createWorkflow({ fetchImpl });

    const response = await workflow.fetchStream(
      "https://cdn.example/track.mp3",
      {
        origin: "https://radio.test",
        request: new Request("https://radio.test/api/test-proxy"),
        requestId: "req_redirect_domain",
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "TEST_INVALID_DOMAIN",
      message: "Invalid domain",
      requestId: "req_redirect_domain",
      status: 400,
    });
    expect(requestedUrls).toEqual(["https://cdn.example/track.mp3"]);
  });

  test("maps aborted upstream fetches to the configured timeout response", async () => {
    const fetchImpl = mock(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) {
            reject(new Error("Missing abort signal"));
            return;
          }

          signal.addEventListener(
            "abort",
            () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        })
    );
    const workflow = createWorkflow({ fetchImpl, fetchTimeoutMs: 1 });

    const response = await workflow.fetchStream(
      "https://cdn.example/track.mp3",
      {
        origin: "https://radio.test",
        request: new Request("https://radio.test/api/test-proxy"),
        requestId: "req_timeout",
      }
    );

    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toEqual({
      code: "TEST_TIMEOUT",
      message: "Request timeout",
      requestId: "req_timeout",
      status: 408,
    });
  });
});
