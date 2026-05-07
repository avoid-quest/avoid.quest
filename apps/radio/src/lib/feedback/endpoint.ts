import { createFeedbackEndpoint, type FeedbackItem } from "git-feedback/server";
import { validateAuthAndRateLimit } from "@/lib/middleware/rate-limit";
import { createSessionCookie } from "@/lib/middleware/session";
import { FEEDBACK_CATEGORIES } from "./config";

const FEEDBACK_REPOSITORY = "avoid-quest/avoid.quest";
const FEEDBACK_LABELS_BY_CATEGORY = {
  bug: "bug",
  idea: "enhancement",
  question: "question",
} as const;
const FEEDBACK_CATEGORY_NAMES_BY_VALUE = {
  bug: "Bug report",
  idea: "Feature idea",
  question: "Question",
} as const;
const FEEDBACK_MODE_NAMES_BY_VALUE = {
  dj: "DJ",
  multiple: "Multiple",
  single: "Single",
} as const;

type FeedbackEnv = {
  readonly GIT_FEEDBACK_GITHUB_TOKEN?: string;
  readonly "proxy-rate-limit"?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
};

type SubmissionErrorCode = "bad_request" | "issue_create_failed";

function feedbackError(error: SubmissionErrorCode, status: number): Response {
  return Response.json({ ok: false, error }, { status });
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
  const modeLabel =
    FEEDBACK_MODE_NAMES_BY_VALUE[
      mode as keyof typeof FEEDBACK_MODE_NAMES_BY_VALUE
    ] ?? mode;
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
    `- Page URL: ${formatTableCell(item.pageUrl?.trim())}`,
    `- User agent: ${formatTableCell(item.userAgent?.trim())}`,
    "",
    "</details>",
  ].join("\n");
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

  const authResult = await validateAuthAndRateLimit(request, env, "feedback", {
    createSessionIfMissing: true,
  });
  if (authResult instanceof Response) {
    return authResult;
  }

  try {
    const endpoint = createFeedbackEndpoint({
      categories: FEEDBACK_CATEGORIES,
      github: {
        repository: FEEDBACK_REPOSITORY,
        credentials: {
          type: "token",
          token,
        },
      },
      issue: {
        formatter: (item) => ({
          body: formatRadioFeedbackIssueBody(item),
          labels: [
            "git-feedback",
            "radio",
            FEEDBACK_LABELS_BY_CATEGORY[
              item.category as keyof typeof FEEDBACK_LABELS_BY_CATEGORY
            ],
          ].filter((label): label is string => Boolean(label)),
        }),
        titlePrefix: "[GF]",
      },
    });

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
