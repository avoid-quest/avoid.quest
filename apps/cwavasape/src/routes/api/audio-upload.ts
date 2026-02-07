import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

const SAFE_KEY_PATTERN = /^[\w\-./]+\.(mp3|wav|ogg)$/;

const MANIFEST_CACHE_KEY = "audio:manifest:v2";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("hmac-key"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const [macA, macB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(a)),
    crypto.subtle.sign("HMAC", key, encoder.encode(b)),
  ]);

  if (macA.byteLength !== macB.byteLength) {
    return false;
  }

  const viewA = new Uint8Array(macA);
  const viewB = new Uint8Array(macB);
  let result = 0;
  for (let i = 0; i < viewA.length; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: constant-time comparison
    result |= viewA[i] ^ viewB[i];
  }
  return result === 0;
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/audio-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return jsonError("Missing authorization", 401);
        }

        const password = authHeader.slice(7);
        const valid = await timingSafeEqual(password, env.UPLOAD_PASSWORD);
        if (!valid) {
          return jsonError("Invalid password", 401);
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

        const sanitized = file.name.toLowerCase().replaceAll(" ", "-");
        const ext = sanitized.split(".").pop();

        if (!(ext && CONTENT_TYPES[ext])) {
          return jsonError("Invalid file type (allowed: mp3, wav, ogg)", 400);
        }

        const key = sanitized;

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
          try {
            await env.CACHE?.delete(MANIFEST_CACHE_KEY);
          } catch {
            // Cache invalidation is best-effort
          }

          return new Response(JSON.stringify({ ok: true, key }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return jsonError(`Upload failed: ${message}`, 500);
        }
      },
    },
  },
});
