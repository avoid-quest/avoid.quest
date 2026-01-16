import { useDraggable } from "@dnd-kit/core";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Toggle } from "@workspace/ui/components/toggle";
import { cn } from "@workspace/ui/lib/utils";
import {
  FilterIcon,
  GripVerticalIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { type EffectConfig, getEffectMetadata } from "@/lib/audio";
import { EFFECT_ICONS } from "./effect-constants";
import { EffectParams } from "./effect-params/effect-params";

type EffectItemProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  onRemove: () => void;
  onExpand?: () => void;
  isExpanded?: boolean;
};

export function EffectItem({
  effect,
  onUpdate,
  onRemove,
  onExpand,
  isExpanded = false,
}: EffectItemProps) {
  const metadata = getEffectMetadata(effect.type);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: effect.id,
      data: { effect },
    });

  const Icon = EFFECT_ICONS[effect.type] ?? FilterIcon;

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const handleEnabledChange = (enabled: boolean) => {
    onUpdate({ enabled });
  };

  const handleReset = () => {
    if (!metadata?.defaultConfig) {
      return;
    }
    onUpdate({
      ...metadata.defaultConfig,
      id: effect.id,
      order: effect.order,
    });
  };

  return (
    <Card
      className={cn(
        "w-full gap-0 border py-0 transition-all duration-200",
        isDragging.valueOf() && "scale-[0.98] opacity-50 shadow-lg",
        effect.enabled.valueOf()
          ? "border-primary/20 bg-primary/5"
          : "opacity-60 grayscale-[30%]",
        isExpanded.valueOf() && "shadow-md"
      )}
      ref={setNodeRef}
      style={style}
    >
      <CardHeader className="flex! items-center! justify-between! flex-row! gap-3 pt-4 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* Drag Handle */}
          <div
            className={cn(
              "cursor-grab touch-manipulation rounded-md p-1.5 text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground active:cursor-grabbing",
              isDragging.valueOf() && "bg-primary/20 text-primary"
            )}
            style={{
              touchAction: "none",
              WebkitTouchCallout: "none",
              WebkitUserSelect: "none",
              userSelect: "none",
            }}
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon className="size-4" />
          </div>

          {/* Icon */}
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
              effect.enabled
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="size-4" />
          </div>

          {/* Title */}
          <CardTitle
            className={cn(
              "cursor-pointer truncate font-medium text-sm transition-colors hover:text-foreground",
              !effect.enabled && "text-muted-foreground"
            )}
            onClick={onExpand}
          >
            {metadata?.name || effect.type}
          </CardTitle>

          {/* Bypassed badge */}
          {!effect.enabled && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              Bypassed
            </span>
          )}
        </div>

        {/** biome-ignore lint/a11y/noNoninteractiveElementInteractions: just a toggle */}
        {/** biome-ignore lint/a11y/noStaticElementInteractions: just a toggle */}
        <div
          className="flex shrink-0 items-center gap-2"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <Toggle
            className={cn(
              "transition-all",
              effect.enabled.valueOf() && "bg-primary text-primary-foreground"
            )}
            onPressedChange={handleEnabledChange}
            pressed={effect.enabled}
            size="sm"
          >
            {effect.enabled ? "ON" : "OFF"}
          </Toggle>
          <Button
            className="h-8 w-8 p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={handleReset}
            size="sm"
            title="Reset to defaults"
            variant="ghost"
          >
            <RotateCcwIcon className="size-4" />
          </Button>
          <Button
            className="h-8 w-8 p-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemove}
            size="sm"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </CardHeader>

      {isExpanded.valueOf() && (
        <CardContent className="border-t bg-muted/30 pt-4 pb-4">
          <EffectParams effect={effect} onUpdate={onUpdate} />
        </CardContent>
      )}
    </Card>
  );
}
