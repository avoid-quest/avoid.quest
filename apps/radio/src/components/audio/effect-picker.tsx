/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Card } from "@avoid.quest/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import { FilterIcon } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useState } from "react";
import { SearchField } from "@/components/radio/search-field";
import { AVAILABLE_EFFECTS, type EffectType } from "@/lib/audio";
import { isEffectContainerType } from "@/lib/audio/dsp/routing/effect-tree";
import { EFFECT_ICONS } from "./effect-constants";

type EffectPickerProps = {
  onSelect: (effectType: EffectType) => void;
  onClose: () => void;
  allowContainers?: boolean;
};

type AvailableEffect = (typeof AVAILABLE_EFFECTS)[number];

function EffectPickerOption({
  effect,
  onSelect,
}: {
  effect: AvailableEffect;
  onSelect: (effectType: EffectType) => void;
}) {
  function selectEffect() {
    onSelect(effect.type);
  }

  function selectEffectWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(effect.type);
    }
  }
  const Icon = EFFECT_ICONS[effect.type] ?? FilterIcon;

  return (
    <Card
      className="cursor-pointer flex-row items-start gap-3 rounded-md border-border/50 p-3 shadow-none outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={selectEffect}
      onKeyDown={selectEffectWithKeyboard}
      role="button"
      tabIndex={0}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium text-sm leading-tight">{effect.name}</h3>
        <span className="mt-1 inline-flex rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
          {effect.family}
        </span>
        <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
          {effect.description}
        </p>
      </div>
    </Card>
  );
}

export function EffectPicker({
  onSelect,
  onClose,
  allowContainers = true,
}: EffectPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  function updateSearchQuery(event: ChangeEvent<HTMLInputElement>) {
    setSearchQuery(event.target.value);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const [first] = filteredEffects;
    if (event.key === "Enter" && first) {
      event.preventDefault();
      onSelect(first.type);
    }
  }

  const filteredEffects = AVAILABLE_EFFECTS.filter(
    (effect) =>
      (allowContainers || !isEffectContainerType(effect.type)) &&
      (effect.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        effect.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add effect</DialogTitle>
          <DialogDescription>
            Type to search. Enter adds the first match.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <SearchField
            autoFocus
            onChange={updateSearchQuery}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search effects…"
            value={searchQuery}
          />

          {filteredEffects.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-xs">
              No effects found. Try a different search term.
            </p>
          ) : (
            <div className="grid max-h-128 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {filteredEffects.map((effect) => (
                <EffectPickerOption
                  effect={effect}
                  key={effect.type}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
