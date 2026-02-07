import { createFileRoute } from "@tanstack/react-router";
import { VirtualGallery } from "@/components/gallery/virtual-gallery";
import { InteractionGate } from "@/components/interaction-gate";
import { SettingsPanel } from "@/components/settings/settings-panel";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <InteractionGate>
      <div className="relative h-full w-full">
        <VirtualGallery />
        <SettingsPanel />
      </div>
    </InteractionGate>
  );
}
