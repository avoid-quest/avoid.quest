import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createBandcampCdnProxyWorkflow } from "@/lib/proxy/bandcamp-cdn-proxy-workflow";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";

const proxyPolicy = createProxyRequestPolicy();
const bandcampProxyWorkflow = createBandcampCdnProxyWorkflow({
  proxyPolicy,
});

export const Route = createFileRoute("/api/bandcamp-proxy")({
  server: {
    handlers: {
      GET: proxyPolicy.get({
        env,
        identifier: "bandcamp-proxy",
        operation: "bandcamp-proxy.GET",
        fallback: {
          code: "BANDCAMP_PROXY_INTERNAL_ERROR",
          safeMessage: "Internal server error",
          category: "infrastructure",
          expected: false,
          status: 500,
        },
        run: bandcampProxyWorkflow.handle,
      }),
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
