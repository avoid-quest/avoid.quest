/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { createFileRoute } from "@tanstack/react-router";
import {
  CLIENT_SENTRY_DSN,
  isAllowedEnvelopeDsn,
  MAX_TUNNEL_ENVELOPE_BYTES,
  readEnvelopeHeader,
  resolveTunnelTarget,
} from "@/lib/sentry/tunnel";

export const Route = createFileRoute("/tunnel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const target = resolveTunnelTarget({
          fallbackDsn: CLIENT_SENTRY_DSN,
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

          const upstreamUrl = `https://${target.host}/api/${target.projectId}/envelope/`;
          const upstream = await fetch(upstreamUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-sentry-envelope",
            },
            body: envelope,
          });

          return new Response(null, {
            status: upstream.status,
            headers: {
              "Cache-Control": "no-store",
            },
          });
        } catch {
          return new Response("Error tunneling to Sentry", { status: 502 });
        }
      },
    },
  },
});
