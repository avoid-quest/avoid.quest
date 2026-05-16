/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createRadioMetadataWorkflow } from "@/lib/metadata/metadata-workflow";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";

const proxyPolicy = createProxyRequestPolicy();
const metadataWorkflow = createRadioMetadataWorkflow();

export const Route = createFileRoute("/api/radio-metadata")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        proxyPolicy.run({
          request,
          env,
          identifier: "radio-metadata",
          operation: "radio-metadata.GET",
          fallback: {
            code: "RADIO_METADATA_INTERNAL_ERROR",
            safeMessage: "Internal server error",
            category: "infrastructure",
            expected: false,
            status: 500,
          },
          run: metadataWorkflow.handle,
        }),
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
