import {
  isAllowedEnvelopeDsn,
  MAX_TUNNEL_ENVELOPE_BYTES,
  readEnvelopeHeader,
  resolveTunnelTarget,
} from "./tunnel";

type TunnelServiceOptions = {
  runtimeDsn?: string | null;
  fallbackDsn?: string | null;
  fetchImpl?: typeof fetch;
};

function forwardTunnelEnvelope(
  envelope: ArrayBuffer,
  target: { host: string; projectId: string },
  fetchImpl: typeof fetch
): Promise<Response> {
  const upstreamUrl = `https://${target.host}/api/${target.projectId}/envelope/`;
  return fetchImpl(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
    },
    body: envelope,
  });
}

export async function handleSentryTunnelRequest(
  request: Request,
  options: TunnelServiceOptions = {}
): Promise<Response> {
  const target = resolveTunnelTarget({
    runtimeDsn: options.runtimeDsn,
    fallbackDsn: options.fallbackDsn,
  });

  if (!target) {
    return new Response("Sentry tunnel not configured", { status: 503 });
  }

  try {
    const envelope = await request.arrayBuffer();
    if (!envelope.byteLength) {
      return new Response("Invalid envelope", { status: 400 });
    }

    if (envelope.byteLength > MAX_TUNNEL_ENVELOPE_BYTES) {
      return new Response("Envelope too large", { status: 413 });
    }

    const header = readEnvelopeHeader(envelope);
    if (!header) {
      return new Response("Invalid envelope", { status: 400 });
    }

    if (!isAllowedEnvelopeDsn(header.dsn, target)) {
      return new Response("Invalid Sentry destination", { status: 403 });
    }

    const upstream = await forwardTunnelEnvelope(
      envelope,
      target,
      options.fetchImpl ?? fetch
    );

    return new Response(null, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Error tunneling to Sentry", { status: 502 });
  }
}
