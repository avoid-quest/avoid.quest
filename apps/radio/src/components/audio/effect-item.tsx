import { Button } from "@avoid.quest/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@avoid.quest/ui/components/card";
import { Toggle } from "@avoid.quest/ui/components/toggle";
import { cn } from "@avoid.quest/ui/lib/utils";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  FilterIcon,
  GripVerticalIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import {
  createDefaultEffectConfig,
  type EffectConfig,
  getEffectMetadata,
} from "@/lib/audio";
import { EFFECT_ICONS } from "./effect-constants";
import { EffectParams } from "./effect-params/effect-params";
import { EffectVisualization } from "./visualizations/effect-visualization";

type EffectItemProps = {
  effect: EffectConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  onRemove: () => void;
  onExpand?: () => void;
  isExpanded?: boolean;
  isDragging?: boolean;
  deckId?: "deck-a" | "deck-b";
  dragHandleRef?: (node: HTMLElement | null) => void;
  dragHandleListeners?: DraggableSyntheticListeners;
  dragHandleAttributes?: DraggableAttributes;
};

export function createEffectResetPatch(
  effect: EffectConfig
): Partial<EffectConfig> {
  return {
    ...createDefaultEffectConfig(effect.type, effect.id, effect.order),
    sidechain: undefined,
  } as Partial<EffectConfig>;
}

export function EffectItem({
  effect,
  onUpdate,
  onRemove,
  onExpand,
  isExpanded = false,
  isDragging = false,
  deckId,
  dragHandleRef,
  dragHandleListeners,
  dragHandleAttributes,
}: EffectItemProps) {
  const metadata = getEffectMetadata(effect.type);
  const effectName = metadata?.name ?? effect.type;

  const Icon = EFFECT_ICONS[effect.type] ?? FilterIcon;

  const handleEnabledChange = (enabled: boolean) => {
    onUpdate({ enabled });
  };

  const handleReset = () => {
    if (!metadata?.defaultConfig) {
      return;
    }
    onUpdate(createEffectResetPatch(effect));
  };

  return (
    <Card
      className={cn(
        "w-full gap-0 border py-0 transition-all duration-200",
        isDragging && "scale-[0.98] opacity-50 shadow-lg",
        effect.enabled
          ? "border-primary/20 bg-primary/5"
          : "opacity-60 grayscale-[30%]",
        isExpanded && "shadow-md"
      )}
    >
      <CardHeader className="flex! items-center! justify-between! flex-row! gap-3 pt-4 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* Drag Handle */}
          <div
            className={cn(
              "cursor-grab touch-manipulation rounded-md p-1.5 text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground active:cursor-grabbing",
              isDragging && "bg-primary/20 text-primary"
            )}
            ref={dragHandleRef}
            style={{
              touchAction: "none",
              WebkitTouchCallout: "none",
              WebkitUserSelect: "none",
              userSelect: "none",
            }}
            {...dragHandleAttributes}
            {...dragHandleListeners}
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
            {effectName}
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
            aria-label={`${effectName} enabled`}
            className={cn(
              "transition-all",
              effect.enabled && "bg-primary text-primary-foreground"
            )}
            onPressedChange={handleEnabledChange}
            pressed={effect.enabled}
            size="sm"
          >
            {effect.enabled ? "ON" : "OFF"}
          </Toggle>
          <Button
            aria-label={`Reset ${effectName}`}
            className="h-8 w-8 p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={handleReset}
            size="sm"
            title="Reset to defaults"
            variant="ghost"
          >
            <RotateCcwIcon className="size-4" />
          </Button>
          <Button
            aria-label={`Remove ${effectName}`}
            className="h-8 w-8 p-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemove}
            size="sm"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4 border-t bg-muted/30 pt-4 pb-4">
          <EffectVisualization effect={effect} />
          <EffectParams
            deckId={deckId}
            effect={effect}
            effectId={effect.id}
            onUpdate={onUpdate}
          />
        </CardContent>
      )}
    </Card>
  );
}
