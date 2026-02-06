import { cn } from "@avoid.quest/ui/lib/utils";
import type { Radio } from "@/lib/audio";
import { DraggableBrowserItem } from "./browser-item";

type BrowserGridProps = {
  items: Radio[];
  className?: string;
};

export function BrowserGrid({ items, className }: BrowserGridProps) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-center">
        <p className="text-muted-foreground text-sm">No items found</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid max-h-[14rem] gap-2 overflow-y-auto",
        "grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]",
        className
      )}
      style={{
        touchAction: "pan-y",
        position: "relative",
        zIndex: 1,
      }}
    >
      {items.map((radio) => (
        <DraggableBrowserItem key={radio.id} radio={radio} />
      ))}
    </div>
  );
}
