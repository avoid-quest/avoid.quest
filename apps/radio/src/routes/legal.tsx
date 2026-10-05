import { LegalPage } from "@avoid.quest/ui/components/legal-page";
import { createFileRoute } from "@tanstack/react-router";

const SOURCE_REVISION = /^[a-f0-9]{40}$/;

export const Route = createFileRoute("/legal")({
  component: Legal,
  loader: async () => {
    const response = await fetch("/legal/build.json");
    if (!response.ok) {
      throw new Error("Unable to load source information for this build");
    }
    const metadata = await response.json();
    const sourceRevision =
      metadata && typeof metadata === "object" && "sourceRevision" in metadata
        ? metadata.sourceRevision
        : undefined;
    if (
      typeof sourceRevision !== "string" ||
      !SOURCE_REVISION.test(sourceRevision)
    ) {
      throw new Error("Missing source revision for this build");
    }
    return { sourceRevision };
  },
  ssr: false,
});

function Legal() {
  const { sourceRevision } = Route.useLoaderData();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <LegalPage sourceRevision={sourceRevision} />
    </div>
  );
}
