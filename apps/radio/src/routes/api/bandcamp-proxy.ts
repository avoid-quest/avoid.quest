/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
  BANDCAMP_CDN_PROXY_CONFIG,
  proxyCdnUrl,
  validateCdnProxyUrl,
} from "@/lib/proxy/cdn-proxy-workflow";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";

const proxyPolicy = createProxyRequestPolicy();

export const Route = createFileRoute("/api/bandcamp-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        proxyPolicy.run({
          request,
          env,
          identifier: BANDCAMP_CDN_PROXY_CONFIG.endpoint,
          operation: "bandcamp-proxy.GET",
          fallback: {
            code: "BANDCAMP_PROXY_INTERNAL_ERROR",
            safeMessage: "Internal server error",
            category: "infrastructure",
            expected: false,
            status: 500,
          },
          run: async ({ origin, request, requestId }) => {
            const urlParam = new URL(request.url).searchParams.get("url");
            const urlValidation = validateCdnProxyUrl({
              urlParam,
              config: BANDCAMP_CDN_PROXY_CONFIG,
            });
            if (!urlValidation.ok) {
              return proxyPolicy.problem(
                urlValidation.error,
                origin,
                requestId
              );
            }

            return proxyCdnUrl({
              config: BANDCAMP_CDN_PROXY_CONFIG,
              origin,
              proxyPolicy,
              request,
              requestId,
              url: urlValidation.url,
            });
          },
        }),
      OPTIONS: ({ request }) => proxyPolicy.options(request),
    },
  },
});
