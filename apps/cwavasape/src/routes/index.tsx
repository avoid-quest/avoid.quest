import { createFileRoute } from "@tanstack/react-router";
import { VirtualGallery } from "@/components/gallery/virtual-gallery";
import { SettingsPanel } from "@/components/settings/settings-panel";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="relative h-full w-full">
      <VirtualGallery />
      <SettingsPanel />
    </div>
  );
}
