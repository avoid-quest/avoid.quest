"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";
import { AVAILABLE_EFFECTS } from "@/lib/audio/effects/registry";

type EffectPickerProps = {
  onSelect: (effectType: string) => void;
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Effect</DialogTitle>
          <DialogDescription>
            Select an effect to add to the chain
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search effects..."
            value={searchQuery}
          />

          <div className="max-h-96 space-y-2 overflow-y-auto">
            {filteredEffects.map((effect) => (
              <Button
                className="w-full justify-start text-left"
                key={effect.type}
                onClick={() => onSelect(effect.type)}
                variant="outline"
              >
                <div className="flex flex-col items-start">
                  <div className="font-medium">{effect.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {effect.description}
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
