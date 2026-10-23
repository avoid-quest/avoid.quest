import { createFileRoute } from "@tanstack/react-router";
import { workerMetadataCache } from "@/lib/metadata/edge-cache";
import { createRadioGuide } from "@/lib/metadata/guide";

const guide = createRadioGuide({ cache: workerMetadataCache });

export const Route = createFileRoute("/guide.xml")({
  server: { handlers: { GET: () => guide.handle() } },
});
