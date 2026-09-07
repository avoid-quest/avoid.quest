import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { metadataEdgeStore } from "@/lib/metadata/edge-store.server";
import { createRadioMetadataWorkflow } from "@/lib/metadata/metadata-workflow";
import { createProxyRouteRegistration } from "@/lib/proxy/proxy-route-registration";

export const Route = createFileRoute("/api/radio-metadata")({
  server: createProxyRouteRegistration({
    createWorkflow: () =>
      createRadioMetadataWorkflow({ store: metadataEdgeStore }),
    env,
    identifier: "radio-metadata",
    internalErrorCode: "RADIO_METADATA_INTERNAL_ERROR",
    operation: "radio-metadata.GET",
  }),
});
