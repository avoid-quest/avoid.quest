import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createBandcampCdnProxyWorkflow } from "@/lib/proxy/bandcamp-cdn-proxy-workflow";
import { createProxyRouteRegistration } from "@/lib/proxy/proxy-route-registration";

export const Route = createFileRoute("/api/bandcamp-proxy")({
  server: createProxyRouteRegistration({
    env,
    identifier: "bandcamp-proxy",
    createWorkflow: (proxyPolicy) =>
      createBandcampCdnProxyWorkflow({
        proxyPolicy,
      }),
  }),
});
