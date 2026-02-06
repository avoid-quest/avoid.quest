/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { createFileRoute } from "@tanstack/react-router";

const SENTRY_HOST = "o4510834344656896.ingest.de.sentry.io";
const SENTRY_PROJECT_ID = "4510834349375568";

export const Route = createFileRoute("/tunnel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const envelope = await request.arrayBuffer();
          const decoder = new TextDecoder();

          // The envelope header is the first line (newline-delimited)
          const headerEnd = new Uint8Array(envelope).indexOf(10); // 0x0A = newline
          if (headerEnd === -1) {
            return new Response("Invalid envelope", { status: 400 });
          }

          const header = JSON.parse(
            decoder.decode(envelope.slice(0, headerEnd))
          );

          const dsn = new URL(header.dsn);
          const projectId = dsn.pathname.replace("/", "");

          // Validate the envelope is destined for our Sentry project
          if (dsn.hostname !== SENTRY_HOST) {
            return new Response("Invalid Sentry host", { status: 403 });
          }
          if (projectId !== SENTRY_PROJECT_ID) {
            return new Response("Invalid project", { status: 403 });
          }

          const upstreamUrl = `https://${SENTRY_HOST}/api/${projectId}/envelope/`;
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
