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

function formatRadioFeedbackIssueBody(item: FeedbackItem): string {
  const category =
    FEEDBACK_CATEGORY_NAMES_BY_VALUE[
      item.category as keyof typeof FEEDBACK_CATEGORY_NAMES_BY_VALUE
    ] ?? item.category?.trim();
  const mode = readStringMetadata(item, "mode");
  // The mode is untrusted client metadata, so only known modes are echoed.
  // A retired mode such as "multiple" reads as Unknown too.
  let modeLabel: string | undefined;
  if (mode !== undefined) {
    modeLabel = Object.hasOwn(FEEDBACK_MODE_NAMES_BY_VALUE, mode)
      ? FEEDBACK_MODE_NAMES_BY_VALUE[mode]
      : "Unknown";
  }
  const contactEmail = readStringMetadata(item, "contactEmail");

  return [
    "## Feedback",
    "",
    item.body.trim(),
    "",
    "## Contact",
    "",
    contactEmail
      ? `- Email: ${formatTableCell(contactEmail)}`
      : "- No contact email provided.",
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
    `- Page URL: ${formatTableCell(item.pageUrl?.trim())}`,
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
  });
}

export async function handleFeedbackRequest(
  request: Request,
  bindings: unknown
): Promise<Response> {
  const env = readFeedbackEnv(bindings);
  const token = env.GIT_FEEDBACK_GITHUB_TOKEN?.trim();

  if (!token) {
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
  } catch (error) {
    console.error("[feedback] Failed to handle feedback request", error);
    return feedbackError("issue_create_failed", 502);
  }
}
