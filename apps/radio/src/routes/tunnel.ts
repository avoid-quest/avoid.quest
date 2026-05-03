/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { createFileRoute } from "@tanstack/react-router";
import { handleSentryTunnelRequest } from "@/lib/sentry/tunnel-service";

export const Route = createFileRoute("/tunnel")({
  server: {
    handlers: {
      POST: ({ request }) => handleSentryTunnelRequest(request),
    },
  },
});
