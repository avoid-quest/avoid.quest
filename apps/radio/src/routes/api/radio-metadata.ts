import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createRadioMetadataWorkflow } from "@/lib/metadata/metadata-workflow";
import { createProxyRouteRegistration } from "@/lib/proxy/proxy-route-registration";

export const Route = createFileRoute("/api/radio-metadata")({
  server: createProxyRouteRegistration({
    env,
    identifier: "radio-metadata",
    operation: "radio-metadata.GET",
    internalErrorCode: "RADIO_METADATA_INTERNAL_ERROR",
    createWorkflow: () => createRadioMetadataWorkflow(),
  }),
});
