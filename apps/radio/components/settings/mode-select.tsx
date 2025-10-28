"use client";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { db } from "@/lib/db";
import { playerModes, type Settings } from "@/lib/types";

export function ModeSelect({ className }: { className?: string }) {
  const settings = useLiveQuery(() => db.settings.limit(1).toArray())?.[0];

  const handleModeChange = async (value: string) => {
    if (!settings?.id) {
      return;
    }

    try {
      const newMode = value as "single" | "multiple" | "dj";

      // Mode change - no cleanup needed with simplified architecture

      const updatedPlayer: Settings["player"] = {
        mode: newMode,
        playerType: settings.player.playerType,
      };

      if (newMode === "single") {
        updatedPlayer.single = {
          transitionDuration:
            settings.player.single?.transitionDuration ??
            DEFAULT_TRANSITION_DURATION,
          lastUsedRadio: settings.player.single?.lastUsedRadio,
        };
      } else {
        updatedPlayer.single = settings.player.single ?? {
          transitionDuration: DEFAULT_TRANSITION_DURATION,
        };
      }

      await db.settings.update(settings.id, {
        player: updatedPlayer,
      });
    } catch (error) {
      console.error("❌ Failed to update mode:", error);
      toast.error("Failed to update mode");
    }
  };

  return (
    <ToggleGroup
      className={cn("w-full max-w-xs", className)}
      onValueChange={handleModeChange}
      type="single"
      value={settings?.player.mode || "multiple"}
      variant="outline"
    >
      {playerModes.map((mode) => (
        <ToggleGroupItem
          className="cursor-pointer px-4"
          key={mode.value}
          value={mode.value}
        >
          {mode.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
