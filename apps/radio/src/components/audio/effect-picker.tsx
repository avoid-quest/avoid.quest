import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { FilterIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { AVAILABLE_EFFECTS, type EffectType } from "@/lib/audio";
import { EFFECT_ICONS } from "./effect-constants";

type EffectPickerProps = {
  onSelect: (effectType: EffectType) => void;
  onClose: () => void;
};

export function EffectPicker({ onSelect, onClose }: EffectPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEffects = AVAILABLE_EFFECTS.filter(
    (effect) =>
      effect.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      effect.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add Effect</DialogTitle>
          <DialogDescription>
            Select an effect to add to the chain
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search effects..."
              value={searchQuery}
            />
          </div>

          {filteredEffects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <SearchIcon className="mb-4 size-12 text-muted-foreground/50" />
              <p className="font-medium text-muted-foreground text-sm">
                No effects found
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                Try a different search term
              </p>
            </div>
          ) : (
            <div className="grid max-h-128 grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              {filteredEffects.map((effect) => {
                const Icon = EFFECT_ICONS[effect.type] ?? FilterIcon;
                return (
                  <Card
                    className={cn(
                      "group cursor-pointer border-2 transition-all duration-200 hover:border-primary/50 hover:shadow-md active:scale-[0.98]",
                      "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
                    )}
                    key={effect.type}
                    onClick={() => onSelect(effect.type)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(effect.type);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                          <Icon className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-sm leading-tight">
                            {effect.name}
                          </h3>
                          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                            {effect.description}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
