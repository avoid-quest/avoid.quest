import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
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
  onAddEffect: (type: string) => void;
  onUpdateEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  onRemoveEffect: (effectId: string) => void;
  onReorderEffects: (effectIds: string[]) => void;
  title?: string;
  showAddButton?: boolean;
  showEffectsList?: boolean;
};

export function EffectChain({
  effects,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  onReorderEffects,
  title,
  showAddButton = true,
  showEffectsList = true,
}: EffectChainProps) {
  const [expandedEffectId, setExpandedEffectId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleAddEffect = (type: string) => {
    onAddEffect(type);
    setShowPicker(false);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = effects.findIndex((e) => e.id === active.id);
    const newIndex = effects.findIndex((e) => e.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newOrder = arrayMove(effects, oldIndex, newIndex);
      onReorderEffects(newOrder.map((e) => e.id));
    }
  };

  const sortedEffects = [...effects].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-2">
      {title && (
        <div className="font-medium text-muted-foreground text-sm">{title}</div>
      )}

      {showEffectsList && (
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <div className="space-y-2">
            <SortableContext
              items={sortedEffects.map((e) => e.id)}
              strategy={verticalListSortingStrategy}
            >
              {sortedEffects.map((effect) => (
                <SortableEffectItem
                  effect={effect}
                  isExpanded={expandedEffectId === effect.id}
                  key={effect.id}
                  onExpand={() =>
                    setExpandedEffectId(
                      expandedEffectId === effect.id ? null : effect.id
                    )
                  }
                  onRemove={() => onRemoveEffect(effect.id)}
                  onUpdate={(config) => onUpdateEffect(effect.id, config)}
                />
              ))}
            </SortableContext>
          </div>
        </DndContext>
      )}

      {showAddButton && (
        <>
          <Button
            className="w-full"
            onClick={() => setShowPicker(true)}
            size="sm"
            variant="outline"
          >
            <Plus className="mr-2 size-4" />
            Add Effect
          </Button>

          {showPicker && (
            <EffectPicker
              onClose={() => setShowPicker(false)}
              onSelect={handleAddEffect}
            />
          )}
        </>
      )}
    </div>
  );
}

function SortableEffectItem({
  effect,
  isExpanded,
  onUpdate,
  onRemove,
  onExpand,
}: {
  effect: EffectConfig;
  isExpanded: boolean;
  onUpdate: (config: Partial<EffectConfig>) => void;
  onRemove: () => void;
  onExpand: () => void;
}) {
  const { setNodeRef, transform, transition, isDragging } = useSortable({
    id: effect.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <EffectItem
        effect={effect}
        isExpanded={isExpanded}
        onExpand={onExpand}
        onRemove={onRemove}
        onUpdate={onUpdate}
      />
    </div>
  );
}
