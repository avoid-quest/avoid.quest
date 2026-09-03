/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { readClientSentryDsn } from "@/lib/sentry/tunnel";
import { handleSentryTunnelRequest } from "@/lib/sentry/tunnel-service";

type RadioSentryEnv = {
  RADIO_SENTRY_DSN?: string;
  SENTRY_DSN?: string;
};

function readRuntimeSentryDsn(): string | undefined {
  const sentryEnv = env as RadioSentryEnv;
  return sentryEnv.RADIO_SENTRY_DSN || sentryEnv.SENTRY_DSN || undefined;
}

export const Route = createFileRoute("/tunnel")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleSentryTunnelRequest(request, {
          fallbackDsn: readClientSentryDsn(),
          runtimeDsn: readRuntimeSentryDsn(),
        }),
    },
  },
});
