import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";
import { createSoundCloudCdnProxyWorkflow } from "@/lib/proxy/soundcloud-cdn-proxy-workflow";

const proxyPolicy = createProxyRequestPolicy();
const soundCloudProxyWorkflow = createSoundCloudCdnProxyWorkflow({
  proxyPolicy,
});

export const Route = createFileRoute("/api/soundcloud-proxy")({
  server: {
    handlers: {
      GET: proxyPolicy.get({
        env,
        identifier: "soundcloud-proxy",
        operation: "soundcloud-proxy.GET",
        fallback: {
          code: "SOUNDCLOUD_PROXY_INTERNAL_ERROR",
          safeMessage: "Internal server error",
          category: "infrastructure",
          expected: false,
          status: 500,
        },
        run: soundCloudProxyWorkflow.handle,
      }),
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
