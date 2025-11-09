"use client";

import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@workspace/ui/components/button";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { EffectConfig } from "@/lib/audio/effects/types";
import { EffectItem } from "./effect-item";
import { EffectPicker } from "./effect-picker";

type EffectChainProps = {
  effects: EffectConfig[];
  isInitialized: boolean;
  onAddEffect: (type: string) => void;
  onUpdateEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  onRemoveEffect: (effectId: string) => void;
  onReorderEffects: (effectIds: string[]) => void;
  title?: string;
};

export function EffectChain({
  effects,
  isInitialized,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffects,
  title,
}: EffectChainProps) {
  const [expandedEffectId, setExpandedEffectId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const handleAddEffect = (type: string) => {
    onAddEffect(type);
    setShowPicker(false);
  };

  const sortedEffects = [...effects].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-2">
      {title && (
        <div className="font-medium text-sm text-muted-foreground">
          {title}
        </div>
      )}

      <div className="space-y-2">
        <SortableContext
          items={sortedEffects.map((e) => e.id)}
          strategy={verticalListSortingStrategy}
        >
          {sortedEffects.map((effect) => (
            <SortableEffectItem
              key={effect.id}
              effect={effect}
              isInitialized={isInitialized}
              isExpanded={expandedEffectId === effect.id}
              onUpdate={(config) => onUpdateEffect(effect.id, config)}
              onRemove={() => onRemoveEffect(effect.id)}
              onExpand={() =>
                setExpandedEffectId(
                  expandedEffectId === effect.id ? null : effect.id
                )
              }
            />
          ))}
        </SortableContext>
      </div>

      <Button
        onClick={() => setShowPicker(true)}
        variant="outline"
        size="sm"
        className="w-full"
        disabled={!isInitialized}
      >
        <Plus className="mr-2 size-4" />
        Add Effect
      </Button>

      {showPicker && (
        <EffectPicker
          onSelect={handleAddEffect}
          onClose={() => setShowPicker(false)}
        />
      )}

      {!isInitialized && (
        <div className="rounded-md bg-muted/50 p-2 text-center">
          <span className="text-muted-foreground text-xs">
            No audio source loaded
          </span>
        </div>
      )}
    </div>
  );
}

function SortableEffectItem({
  effect,
  isInitialized,
  isExpanded,
  onUpdate,
  onRemove,
  onExpand,
}: {
  effect: EffectConfig;
  isInitialized: boolean;
  isExpanded: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  onRemove: () => void;
  onExpand: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: effect.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <EffectItem
        effect={effect}
        isInitialized={isInitialized}
        isExpanded={isExpanded}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onExpand={onExpand}
      />
    </div>
  );
}
