"use client";

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
  Clock,
  Filter,
  FireExtinguisher,
  GripVertical,
  Radio,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { getEffectMetadata } from "@/lib/audio/effects/registry";
import type { EffectConfig, EffectType } from "@/lib/audio/effects/types";
import { EffectParams } from "./effect-params/effect-params";

const EFFECT_ICONS: Record<EffectType, typeof Filter> = {
  biquadFilter: Filter,
  reverb: Waves,
  delay: Clock,
  distortion: Zap,
  compressor: FireExtinguisher,
  panner: Radio,
};

type EffectItemProps = {
  effect: EffectConfig;
  isInitialized: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  onRemove: () => void;
  onExpand?: () => void;
  isExpanded?: boolean;
};

export function EffectItem({
  effect,
  isInitialized,
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

  const Icon = EFFECT_ICONS[effect.type] ?? Filter;

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const handleEnabledChange = (enabled: boolean) => {
    onUpdate({ enabled });
  };

  return (
    <Card
      className={cn(
        "w-full border transition-all duration-200",
        isDragging && "scale-[0.98] opacity-50 shadow-lg",
        !isInitialized && "opacity-60",
        effect.enabled && "border-primary/20 bg-primary/5",
        isExpanded && "shadow-md"
      )}
      ref={setNodeRef}
      style={style}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {/* Drag Handle */}
            <div
              className={cn(
                "cursor-grab touch-manipulation rounded-md p-1.5 text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground active:cursor-grabbing",
                isDragging && "bg-primary/20 text-primary"
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
              <GripVertical className="size-4" />
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
                effect.enabled && "bg-primary text-primary-foreground"
              )}
              disabled={!isInitialized}
              onPressedChange={handleEnabledChange}
              pressed={effect.enabled}
              size="sm"
            >
              {effect.enabled ? "ON" : "OFF"}
            </Toggle>
            <Button
              className="h-8 w-8 p-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              onClick={onRemove}
              size="sm"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="border-t bg-muted/30 pt-4">
          <EffectParams
            effect={effect}
            isInitialized={isInitialized}
            onUpdate={onUpdate}
          />
        </CardContent>
      )}
    </Card>
  );
}
