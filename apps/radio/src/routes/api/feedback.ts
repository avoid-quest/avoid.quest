/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { handleFeedbackRequest } from "@/lib/feedback/endpoint";

export const Route = createFileRoute("/api/feedback")({
  server: {
    handlers: {
      POST: ({ request }) => handleFeedbackRequest(request, env),
    },
  },
});
