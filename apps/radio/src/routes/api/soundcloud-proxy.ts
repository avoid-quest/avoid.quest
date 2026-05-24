/** biome-ignore-all lint/suspicious/useAwait: needed for server-only */

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { logSSRFAttempt } from "@/lib/logger";
import {
  proxyCdnUrl,
  SOUNDCLOUD_CDN_PROXY_CONFIG,
  validateCdnProxyUrl,
} from "@/lib/proxy/cdn-proxy-workflow";
import { createProxyRequestPolicy } from "@/lib/proxy/request-policy";

const proxyPolicy = createProxyRequestPolicy();

export const Route = createFileRoute("/api/soundcloud-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        proxyPolicy.run({
          request,
          env,
          identifier: SOUNDCLOUD_CDN_PROXY_CONFIG.endpoint,
          operation: "soundcloud-proxy.GET",
          fallback: {
            code: "SOUNDCLOUD_PROXY_INTERNAL_ERROR",
            safeMessage: "Internal server error",
            category: "infrastructure",
            expected: false,
            status: 500,
          },
          run: async ({ auth, origin, request, requestId }) => {
            const urlParam = new URL(request.url).searchParams.get("url");
            const urlValidation = validateCdnProxyUrl({
              urlParam,
              config: SOUNDCLOUD_CDN_PROXY_CONFIG,
              logRejectedUrl: (url) =>
                logSSRFAttempt(
                  auth.sessionId,
                  url,
                  SOUNDCLOUD_CDN_PROXY_CONFIG.endpoint,
                  auth.ip
                ),
            });
            if (!urlValidation.ok) {
              return proxyPolicy.problem(
                urlValidation.error,
                origin,
                requestId
              );
            }

            return proxyCdnUrl({
              config: SOUNDCLOUD_CDN_PROXY_CONFIG,
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
