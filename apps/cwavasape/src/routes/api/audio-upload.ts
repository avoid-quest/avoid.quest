import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { CONTENT_TYPES, SAFE_KEY_PATTERN } from "../../lib/audio-constants";
import { jsonError, jsonOk, verifyUploadAuth } from "../../lib/auth";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export const Route = createFileRoute("/api/audio-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await verifyUploadAuth(request);
        if (authError) {
          return authError;
        }

        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return jsonError("Invalid multipart form data", 400);
        }

        const file = formData.get("file");
        if (!(file instanceof File)) {
          return jsonError("Missing file", 400);
        }

        if (file.size > MAX_FILE_SIZE) {
          return jsonError("File too large (max 50 MB)", 413);
        }

        const key = file.name.toLowerCase().replaceAll(" ", "-");
        const ext = key.split(".").pop();

        if (!(ext && CONTENT_TYPES[ext])) {
          return jsonError("Invalid file type (allowed: mp3, wav, ogg)", 400);
        }

        if (
          key.includes("..") ||
          key.startsWith("/") ||
          !SAFE_KEY_PATTERN.test(key)
        ) {
          return jsonError("Invalid filename", 400);
        }

        try {
          const arrayBuffer = await file.arrayBuffer();

          await env.cwavasape_audio_samples.put(key, arrayBuffer, {
            httpMetadata: { contentType: CONTENT_TYPES[ext] },
          });

          // Invalidate the manifest cache so the new file shows up
          const origin = new URL(request.url).origin;
          await caches.default.delete(
            new Request(`${origin}/api/audio-samples`)
          );

          return jsonOk({ key });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return jsonError(`Upload failed: ${message}`, 500);
        }
      },
    },
  },
});
