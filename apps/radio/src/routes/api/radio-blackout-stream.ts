import { createFileRoute } from "@tanstack/react-router";
import { handleRadioBlackoutStreamRequest } from "@/lib/audio/radio-blackout-stream";

export const Route = createFileRoute("/api/radio-blackout-stream")({
  server: {
    handlers: {
      GET: ({ request }) => handleRadioBlackoutStreamRequest(request),
      HEAD: ({ request }) => handleRadioBlackoutStreamRequest(request),
    },
  },
});
