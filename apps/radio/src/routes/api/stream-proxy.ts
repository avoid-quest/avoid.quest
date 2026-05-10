/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";
import { inspectStreamAccess } from "@/lib/proxy/stream-access";
import { createStreamProxyRequestWorkflow } from "@/lib/proxy/stream-proxy-workflow";

const proxyPolicy = createProxyRequestPolicy();
const streamProxyWorkflow = createStreamProxyRequestWorkflow({
  inspectStreamAccess,
  proxyPolicy,
});

export const Route = createFileRoute("/api/stream-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        proxyPolicy.run({
          request,
          env,
          identifier: "stream-proxy",
          operation: "stream-proxy.GET",
          fallback: {
            code: "STREAM_PROXY_INTERNAL_ERROR",
            safeMessage: "Internal server error",
            category: "infrastructure",
            expected: false,
            status: 500,
          },
          run: streamProxyWorkflow.handle,
        }),
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
