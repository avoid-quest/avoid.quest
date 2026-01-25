import { createFileRoute } from "@tanstack/react-router";
import { VirtualGallery } from "@/components/gallery/virtual-gallery";
import { SettingsDrawer } from "@/components/settings/settings-drawer";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="relative h-full w-full">
      <VirtualGallery />
      <SettingsDrawer />
    </div>
  );
}
