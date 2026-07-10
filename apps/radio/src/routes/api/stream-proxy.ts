import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createProxyRouteRegistration } from "@/lib/proxy/proxy-route-registration";
import { createStreamProxyRequestWorkflow } from "@/lib/proxy/stream-proxy-workflow";

export const Route = createFileRoute("/api/stream-proxy")({
  server: createProxyRouteRegistration({
    env,
    identifier: "stream-proxy",
    operation: "stream-proxy.GET",
    internalErrorCode: "STREAM_PROXY_INTERNAL_ERROR",
    createWorkflow: (proxyPolicy) =>
      createStreamProxyRequestWorkflow({
        proxyPolicy,
      }),
  }),
});
