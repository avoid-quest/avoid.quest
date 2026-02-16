/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

const LEADING_SLASH_PATTERN = /^\//;

function getDsnFromEnv(): string | undefined {
  const envMap = env as unknown as Record<string, string | undefined>;
  return envMap.SENTRY_DSN ?? envMap.VITE_SENTRY_DSN;
}

function getConfiguredDsn(configuredDsnValue?: string): URL | null {
  const dsn =
    configuredDsnValue ?? process.env.SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;
  if (!dsn) {
    return null;
  }

  try {
    return new URL(dsn);
  } catch {
    return null;
  }
}

function getProjectIdFromDsn(dsn: URL): string {
  return dsn.pathname.replace(LEADING_SLASH_PATTERN, "");
}

export const Route = createFileRoute("/tunnel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const configuredDsn = getConfiguredDsn(getDsnFromEnv());
        if (!configuredDsn) {
          return new Response("Sentry DSN not configured", { status: 503 });
        }

        const configuredProjectId = getProjectIdFromDsn(configuredDsn);

        try {
          const envelope = await request.arrayBuffer();
          const decoder = new TextDecoder();

          const headerEnd = new Uint8Array(envelope).indexOf(10);
          if (headerEnd === -1) {
            return new Response("Invalid envelope", { status: 400 });
          }

          const header = JSON.parse(
            decoder.decode(envelope.slice(0, headerEnd))
          ) as { dsn?: string };

          const envelopeDsn = new URL(header.dsn ?? "");
          const envelopeProjectId = getProjectIdFromDsn(envelopeDsn);

          if (envelopeDsn.hostname !== configuredDsn.hostname) {
            return new Response("Invalid Sentry host", { status: 403 });
          }
          if (envelopeProjectId !== configuredProjectId) {
            return new Response("Invalid project", { status: 403 });
          }

          const upstreamUrl = `https://${configuredDsn.hostname}/api/${configuredProjectId}/envelope/`;
          const response = await fetch(upstreamUrl, {
            method: "POST",
            headers: {
              "Content-Type":
                request.headers.get("Content-Type") ??
                "application/x-sentry-envelope",
            },
            body: envelope,
          });

          return new Response(response.body, {
            status: response.status,
            headers: {
              "Content-Type":
                response.headers.get("Content-Type") ??
                "application/octet-stream",
            },
          });
        } catch {
          return new Response("Error tunneling to Sentry", { status: 500 });
        }
      },
    },
  },
});
