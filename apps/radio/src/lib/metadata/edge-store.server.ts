import { getRequest } from "@tanstack/react-start/server";
import { createMetadataEdgeStore } from "./edge-store";

// Resolve the request and Cache API lazily, inside the Worker request context.
export const metadataEdgeStore = createMetadataEdgeStore(
  () => getRequest().url
);
