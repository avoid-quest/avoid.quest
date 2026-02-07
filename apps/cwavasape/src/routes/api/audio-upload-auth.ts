import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

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

export const Route = createFileRoute("/api/audio-upload-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response(
            JSON.stringify({ ok: false, error: "Missing authorization" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        }

        const password = authHeader.slice(7);
        const valid = await timingSafeEqual(password, env.UPLOAD_PASSWORD);

        if (!valid) {
          return new Response(
            JSON.stringify({ ok: false, error: "Invalid password" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
