import { createFeedbackEndpoint } from "git-feedback/server";
import { getSessionId } from "@/lib/auth/session";
import { logRateLimitViolation } from "@/lib/logger";
import { getClientIP } from "@/lib/middleware/rate-limit";
import { createSessionCookie } from "@/lib/middleware/session";
import { getOrCreateSessionFromRequest } from "@/lib/middleware/session-creation";
import { checkRateLimit } from "@/lib/rate-limit";
import { FEEDBACK_CATEGORIES } from "./config";

const FEEDBACK_REPOSITORY = "avoid-quest/avoid.quest";
const FEEDBACK_RATE_LIMIT_IDENTIFIER = "feedback";
const UNKNOWN_FEEDBACK_IP = "unknown";
const FEEDBACK_LABELS_BY_CATEGORY = {
  bug: "bug",
  idea: "enhancement",
  question: "question",
} as const;

type FeedbackEnv = {
  readonly GIT_FEEDBACK_GITHUB_TOKEN?: string;
  readonly "proxy-rate-limit"?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
};

type SubmissionErrorCode =
  | "bad_request"
  | "issue_create_failed"
  | "submission_blocked";

function feedbackError(error: SubmissionErrorCode, status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

function readFeedbackEnv(bindings: unknown): FeedbackEnv {
  return bindings as FeedbackEnv;
}

function getFeedbackRateLimitKey(request: Request): string {
  const trustedClientIp = request.headers.get("cf-connecting-ip")?.trim();
  return `ip:${trustedClientIp || UNKNOWN_FEEDBACK_IP}`;
}

async function checkFeedbackRateLimit(
  request: Request,
  env: FeedbackEnv
): Promise<{ sessionCookie?: string } | Response> {
  const cookieHeader = request.headers.get("cookie");
  const existingSessionId = getSessionId(cookieHeader);
  const session = existingSessionId
    ? { sessionId: existingSessionId, shouldSetCookie: false }
    : getOrCreateSessionFromRequest(cookieHeader);
  const rateLimitSubject = getFeedbackRateLimitKey(request);

  const rateLimitResult = await checkRateLimit(
    env,
    rateLimitSubject,
    FEEDBACK_RATE_LIMIT_IDENTIFIER
  );

  if (!rateLimitResult.allowed) {
    logRateLimitViolation(
      rateLimitSubject,
      FEEDBACK_RATE_LIMIT_IDENTIFIER,
      getClientIP(request)
    );
    return feedbackError("submission_blocked", 429);
  }

  return session.shouldSetCookie
    ? { sessionCookie: createSessionCookie(session.sessionId) }
    : {};
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

  const rateLimit = await checkFeedbackRateLimit(request, env);
  if (rateLimit instanceof Response) {
    return rateLimit;
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

    if (rateLimit.sessionCookie) {
      response.headers.append("Set-Cookie", rateLimit.sessionCookie);
    }

    return response;
  } catch (error) {
    console.error("[feedback] Failed to handle feedback request", error);
    return feedbackError("issue_create_failed", 502);
  }
}
