import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createProxyRouteRegistration } from "@/lib/proxy/proxy-route-registration";
import { inspectStreamAccess } from "@/lib/proxy/stream-access";
import { createStreamProxyRequestWorkflow } from "@/lib/proxy/stream-proxy-workflow";

export const Route = createFileRoute("/api/stream-proxy")({
  server: createProxyRouteRegistration({
    env,
    identifier: "stream-proxy",
    createWorkflow: (proxyPolicy) =>
      createStreamProxyRequestWorkflow({
        inspectStreamAccess,
        proxyPolicy,
      }),
  }),
});
