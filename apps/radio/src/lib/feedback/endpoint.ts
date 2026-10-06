import { AppError, captureError } from "@avoid.quest/error";
import { Octokit as OctokitCore } from "@octokit/core";
import { restEndpointMethods } from "@octokit/plugin-rest-endpoint-methods";
import { createGitHubAdapter } from "git-feedback/github";
import { createFeedbackEndpoint, type FeedbackItem } from "git-feedback/server";
import { validateAuthAndRateLimit } from "@/lib/middleware/rate-limit";
import { createSessionCookie } from "@/lib/middleware/session";
import { FEEDBACK_CATEGORIES } from "./config";

const FEEDBACK_REPOSITORY = "avoid-quest/avoid.quest";
const [FEEDBACK_REPOSITORY_OWNER, FEEDBACK_REPOSITORY_NAME] =
  FEEDBACK_REPOSITORY.split("/") as [string, string];
const FEEDBACK_LABELS_BY_CATEGORY: Record<
  (typeof FEEDBACK_CATEGORIES)[number],
  string
> = {
  bug: "bug",
  idea: "enhancement",
  question: "question",
};
const FEEDBACK_CATEGORY_NAMES_BY_VALUE = {
  bug: "Bug report",
  idea: "Feature idea",
  question: "Question",
} as const;
const FEEDBACK_MODE_NAMES_BY_VALUE: Readonly<Record<string, string>> = {
  dj: "DJ",
  // Retired with Node, but kept: a report from a client still offering it
  // shows triage that client is outdated.
  multiple: "Multiple",
  node: "Node",
  single: "Single",
};
const APP_VERSION =
  typeof __APP_VERSION__ === "string"
    ? __APP_VERSION__
    : (process.env.npm_package_version ?? "unknown");
const Octokit = OctokitCore.plugin(restEndpointMethods);

type FeedbackEnv = {
  readonly GIT_FEEDBACK_GITHUB_TOKEN?: string;
  readonly "proxy-rate-limit"?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
};

type SubmissionErrorCode = "bad_request" | "issue_create_failed";

function feedbackError(error: SubmissionErrorCode, status: number): Response {
  return Response.json({ error, ok: false }, { status });
}

function readFeedbackEnv(bindings: unknown): FeedbackEnv {
  return bindings as FeedbackEnv;
}

function readStringMetadata(
  item: FeedbackItem,
  key: string
): string | undefined {
  const value = item.untrustedMetadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatTableCell(value: string | undefined): string {
  return (value || "Not provided").replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function publicPageUrl(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? "");
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function formatRadioFeedbackIssueBody(item: FeedbackItem): string {
  const category =
    FEEDBACK_CATEGORY_NAMES_BY_VALUE[
      item.category as keyof typeof FEEDBACK_CATEGORY_NAMES_BY_VALUE
    ] ?? item.category?.trim();
  const mode = readStringMetadata(item, "mode");
  // The mode is untrusted client metadata, so only known modes, the retired
  // Multiple included, are echoed; anything else reads as Unknown.
  let modeLabel: string | undefined;
  if (mode !== undefined) {
    modeLabel = Object.hasOwn(FEEDBACK_MODE_NAMES_BY_VALUE, mode)
      ? FEEDBACK_MODE_NAMES_BY_VALUE[mode]
      : "Unknown";
  }

  return [
    "## Feedback",
    "",
    item.body.trim(),
    "",
    "## Context",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Category | ${formatTableCell(category)} |`,
    `| Mode | ${formatTableCell(modeLabel)} |`,
    "",
    "<details>",
    "<summary>Details</summary>",
    "",
    `- App version: ${formatTableCell(`v${APP_VERSION}`)}`,
    `- Page URL: ${formatTableCell(publicPageUrl(item.pageUrl))}`,
    `- User agent: ${formatTableCell(item.userAgent?.trim())}`,
    "",
    "</details>",
  ].join("\n");
}

function createRadioFeedbackEndpoint(token: string) {
  const octokit = new Octokit({ auth: token });

  return createFeedbackEndpoint({
    adapter: createGitHubAdapter({
      client: octokit,
      customizeIssueInput(input, { issue }) {
        const labels = new Set(input.labels ?? []);
        const categoryLabel = issue.category
          ? FEEDBACK_LABELS_BY_CATEGORY[
              issue.category as (typeof FEEDBACK_CATEGORIES)[number]
            ]
          : undefined;

        if (categoryLabel) {
          labels.add(categoryLabel);
        }

        return { ...input, labels: [...labels] };
      },
      input: {
        labels: ["git-feedback", "radio"],
        owner: FEEDBACK_REPOSITORY_OWNER,
        repo: FEEDBACK_REPOSITORY_NAME,
      },
    }),
    categories: FEEDBACK_CATEGORIES,
    issue: {
      formatter: (item) => ({
        body: formatRadioFeedbackIssueBody(item),
      }),
      titlePrefix: "[GF]",
    },
    // The library logs provider errors with request payloads by default.
    logger: false,
    onCreateIssueError: () => {
      reportFeedbackFailure("FEEDBACK_CREATE_FAILED");
    },
  });
}

function reportFeedbackFailure(code: string): void {
  // Provider exceptions can embed the submitted text and credentials.
  captureError(
    new AppError({
      category: "infrastructure",
      code,
      expected: false,
      safeMessage: "Failed to submit feedback",
    }),
    { operation: "submitFeedback", surface: "api-route" }
  );
}

export async function handleFeedbackRequest(
  request: Request,
  bindings: unknown
): Promise<Response> {
  const env = readFeedbackEnv(bindings);
  const token = env.GIT_FEEDBACK_GITHUB_TOKEN?.trim();

  if (!token) {
    reportFeedbackFailure("FEEDBACK_NOT_CONFIGURED");
    return feedbackError("issue_create_failed", 502);
  }

  const endpoint = createRadioFeedbackEndpoint(token);

  if (request.method === "GET") {
    return endpoint(request);
  }

  const authResult = await validateAuthAndRateLimit(request, env, "feedback", {
    createSessionIfMissing: true,
  });
  if (authResult instanceof Response) {
    return authResult;
  }

  try {
    const response = await endpoint(request);

    if (authResult.shouldSetCookie) {
      response.headers.append(
        "Set-Cookie",
        createSessionCookie(authResult.sessionId)
      );
    }

    return response;
  } catch {
    // Provider errors can embed the submitted request, including legacy metadata.
    reportFeedbackFailure("FEEDBACK_ENDPOINT_FAILED");
    return feedbackError("issue_create_failed", 502);
  }
}
