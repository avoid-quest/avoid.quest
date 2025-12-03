import { env } from "cloudflare:workers";
import { getBandcampItem } from "@avoid.quest/bandcamp";
import type { PlatformItemResponse } from "@avoid.quest/radio-shared";
import { getSoundCloudItem } from "@avoid.quest/soundcloud";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { z } from "zod";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import { getCorsHeaders, getCorsOptionsHeaders } from "@/lib/middleware/cors";
import { validateAuthAndRateLimit } from "@/lib/middleware/rate-limit";
import { createSessionCookie } from "@/lib/middleware/session";

const REQUEST_BODY_SCHEMA = z.object({
  url: z.string(),
});

const URL_SCHEMA = z
  .string()
  .max(2048)
  .refine((val) => {
    try {
      new URL(val);
      return true;
    } catch {
      return false;
    }
  }, "Invalid URL format");

function getResponseHeaders(
  origin: string,
  shouldSetCookie: boolean,
  sessionId: string
): Record<string, string> {
  const headers = getCorsHeaders(origin);
  if (shouldSetCookie) {
    headers["Set-Cookie"] = createSessionCookie(sessionId);
  }
  return headers;
}

export const Route = createFileRoute("/api/load-platform-item")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let origin = "*";
        try {
          origin = new URL(request.url).origin;
        } catch {
          // Fallback if URL parsing fails
        }

        try {
          // Validate authentication and rate limiting (creates session if missing)
          const authResult = await validateAuthAndRateLimit(
            request,
            env,
            "load-platform-item"
          );
          if (authResult instanceof Response) {
            return authResult;
          }

          const { sessionId, shouldSetCookie } = authResult;

          const body = await request.json();
          const bodyValidation = REQUEST_BODY_SCHEMA.safeParse(body);

          if (!bodyValidation.success) {
            return json(
              { success: false, error: "Invalid request body" },
              {
                status: 400,
                headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
              }
            );
          }

          const { url } = bodyValidation.data;

          // Input validation
          if (!url.trim()) {
            return json(
              { success: false, error: "Please enter a valid URL" },
              {
                status: 400,
                headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
              }
            );
          }

          const trimmedUrl = url.trim();

          // Validate URL format with Zod
          const urlValidation = URL_SCHEMA.safeParse(trimmedUrl);
          if (!urlValidation.success) {
            return json(
              {
                success: false,
                error:
                  "Invalid URL format. Please enter a valid URL (max 2048 characters).",
              },
              {
                status: 400,
                headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
              }
            );
          }

          const platform = detectPlatformFromUrl(trimmedUrl);

          if (!platform) {
            return json(
              {
                success: false,
                error:
                  "Unsupported URL. Please enter a Bandcamp or SoundCloud URL.",
              },
              {
                status: 400,
                headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
              }
            );
          }

          let result: PlatformItemResponse;

          if (platform === "bandcamp") {
            result = await getBandcampItem(trimmedUrl);
          } else if (platform === "soundcloud") {
            result = await getSoundCloudItem(trimmedUrl);
          } else {
            return json(
              { success: false, error: "Unsupported platform" },
              {
                status: 400,
                headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
              }
            );
          }

          return json(result, {
            status: result.success ? 200 : 400,
            headers: getResponseHeaders(origin, shouldSetCookie, sessionId),
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";
          console.error("Load platform item error:", errorMessage, error);
          return json(
            {
              success: false,
              error: `Failed to process request: ${errorMessage}`,
            },
            {
              status: 500,
              headers: getCorsHeaders(origin),
            }
          );
        }
      },
      OPTIONS: ({ request }) => {
        const origin = new URL(request.url).origin;
        return new Response(null, {
          status: 200,
          headers: getCorsOptionsHeaders(origin),
        });
      },
    },
  },
});
