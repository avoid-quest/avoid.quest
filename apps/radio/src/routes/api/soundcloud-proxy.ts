import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createProxyRouteRegistration } from "@/lib/proxy/proxy-route-registration";
import { createSoundCloudCdnProxyWorkflow } from "@/lib/proxy/soundcloud-cdn-proxy-workflow";

export const Route = createFileRoute("/api/soundcloud-proxy")({
  server: createProxyRouteRegistration({
    env,
    identifier: "soundcloud-proxy",
    createWorkflow: (proxyPolicy) =>
      createSoundCloudCdnProxyWorkflow({
        proxyPolicy,
      }),
  }),
});
