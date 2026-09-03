// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { useDraggable } from "@dnd-kit/core";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GripVerticalIcon,
} from "lucide-react";
import type { Radio } from "@/lib/audio";
import { getDjDeckModule } from "@/lib/dj-deck";
import { isPlatformPlaceholderItem } from "@/lib/dj-library-sources";
import { RadioItemContent } from "../dj-radio-list";

export function DraggableBrowserItem({ radio }: { radio: Radio }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      data: { radio },
      id: `radio-${radio.id}`,
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;
  const isPlatform = isPlatformPlaceholderItem(radio);

  return (
    <div
      className={`flex w-full shrink-0 items-center gap-2 rounded-lg border bg-card p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md ${
        isDragging ? "cursor-grabbing opacity-50 shadow-lg" : "cursor-grab"
      } ${isPlatform ? "border-primary/50 border-dashed bg-primary/5" : ""}`}
      ref={setNodeRef}
      style={{
        ...style,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
      {...attributes}
      {...listeners}
    >
      <div className="rounded p-0.5">
        <GripVerticalIcon className="size-3.5 text-muted-foreground/50" />
      </div>
      <RadioItemContent radio={radio} />
    </div>
  );
}

export function MobileBrowserItem({ radio }: { radio: Radio }) {
  const handleLoad = (deckId: "deck-a" | "deck-b") => {
    getDjDeckModule()
      .deck(deckId)
      .load({ radio, type: "library" })
      .catch((error) => {
        console.error("[dj] Failed to load browser source:", error);
      });
  };
  const handleLoadDeckA = () => handleLoad("deck-a");
  const handleLoadDeckB = () => handleLoad("deck-b");

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 rounded-lg border bg-card p-2.5">
      <RadioItemContent radio={radio} />
      <div className="flex shrink-0 gap-1">
        <Button
          aria-label="Load to Deck A"
          className="h-7 w-7 p-0"
          onClick={handleLoadDeckA}
          size="sm"
          title="Load to Deck A"
          variant="outline"
        >
          <ChevronLeftIcon className="size-3.5" />
        </Button>
        <Button
          aria-label="Load to Deck B"
          className="h-7 w-7 p-0"
          onClick={handleLoadDeckB}
          size="sm"
          title="Load to Deck B"
          variant="outline"
        >
          <ChevronRightIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
