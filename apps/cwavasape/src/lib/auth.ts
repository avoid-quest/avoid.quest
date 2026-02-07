import { env } from "cloudflare:workers";

async function timingSafeEqual(a: string, b: string) {
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

export function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonOk(data: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function verifyUploadAuth(request: Request) {
  if (!env.UPLOAD_PASSWORD) {
    return jsonError("Server misconfigured", 500);
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError("Missing authorization", 401);
  }

  const password = authHeader.slice(7);
  const valid = await timingSafeEqual(password, env.UPLOAD_PASSWORD);
  if (!valid) {
    return jsonError("Invalid password", 401);
  }

  return null;
}
