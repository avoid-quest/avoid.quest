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
import { GripVertical, X } from "lucide-react";
import { getEffectMetadata } from "@/lib/audio/effects/registry";
import type { EffectConfig } from "@/lib/audio/effects/types";
import { EffectParams } from "./effect-params";

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
        "w-full transition-all",
        isDragging && "opacity-50 shadow-lg",
        !isInitialized && "opacity-60"
      )}
      ref={setNodeRef}
      style={style}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* Drag Handle */}
            <div
              className={cn(
                "cursor-grab touch-manipulation rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground active:cursor-grabbing",
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

            <CardTitle
              className="cursor-pointer truncate text-sm"
              onClick={onExpand}
            >
              {metadata?.name || effect.type}
            </CardTitle>
          </div>

          <div className="flex items-center gap-2">
            <Toggle
              disabled={!isInitialized}
              onPressedChange={handleEnabledChange}
              pressed={effect.enabled}
              size="sm"
            >
              {effect.enabled ? "ON" : "OFF"}
            </Toggle>
            <Button
              className="h-8 w-8 p-0"
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
        <CardContent className="pt-0">
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
