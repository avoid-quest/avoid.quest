import { createFileRoute } from "@tanstack/react-router";
import { jsonOk, verifyUploadAuth } from "../../lib/auth";

export const Route = createFileRoute("/api/audio-upload-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await verifyUploadAuth(request);
        if (authError) {
          return authError;
        }

        return jsonOk();
      },
    },
  },
});
