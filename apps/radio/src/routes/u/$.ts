import { createFileRoute } from "@tanstack/react-router";
import { handleUmamiRequest } from "@/lib/umami-proxy";

export const Route = createFileRoute("/u/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleUmamiRequest(request),
      HEAD: ({ request }) => handleUmamiRequest(request),
      POST: ({ request }) => handleUmamiRequest(request),
    },
  },
});
