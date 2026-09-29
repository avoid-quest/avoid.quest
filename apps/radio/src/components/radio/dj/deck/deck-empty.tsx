import { cn } from "@avoid.quest/ui/lib/utils";
import { EffectChain } from "@/components/audio/effect-chain";
import type { EffectConfig, EffectType, Radio } from "@/lib/audio";
import { DjRadioList } from "../dj-radio-list";

type DeckEmptyProps = {
  deckId: "deck-a" | "deck-b";
  radios: Radio[];
  effects: EffectConfig[];
  addEffect: (type: EffectType) => void;
  updateEffect: (effectId: string, config: Partial<EffectConfig>) => void;
  removeEffect: (effectId: string) => void;
  reorderEffects: (effectIds: string[]) => void;
  className?: string;
};

/** Empty deck: search and pick a source right here. Drops still work. */
export function DeckEmpty({
  deckId,
  radios,
  effects,
  addEffect,
  updateEffect,
  removeEffect,
  reorderEffects,
  className,
}: DeckEmptyProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DjRadioList deckId={deckId} radios={radios} />
      </div>
      <p className="shrink-0 py-1.5 text-center text-muted-foreground text-xs [@media(pointer:coarse)]:hidden">
        or drop an audio file here
      </p>

      {effects.length > 0 && (
        <div className="shrink-0 border-border/50 border-t px-2 py-2">
          <EffectChain
            effects={effects}
            onAddEffect={addEffect}
            onRemoveEffect={removeEffect}
            onReorderEffects={reorderEffects}
            onUpdateEffect={updateEffect}
            showAddButton={false}
          />
        </div>
      )}
    </div>
  );
}
