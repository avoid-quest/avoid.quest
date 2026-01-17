import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import { useLiveQuery } from "dexie-react-hooks";
import { LayersIcon, ListMusicIcon, SwordsIcon } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { db } from "@/lib/db";
import { useDjStore } from "@/lib/stores/dj-store";
import { playerModes, type Settings } from "@/lib/types";

const modeIcons = {
  multiple: LayersIcon,
  single: ListMusicIcon,
  dj: SwordsIcon,
} as const;

export function ModeSelect({ className }: { className?: string }) {
  const settings = useLiveQuery(() => db.settings.limit(1).toArray())?.[0];

  const handleModeChange = async (value: string) => {
    if (!settings?.id) {
      return;
    }

    try {
      // Stop audio before switching modes (preserves persisted radio state)
      await useDjStore.getState().cleanupAudioOnly();

      const newMode = value as "single" | "multiple" | "dj";

      const updatedPlayer: Settings["player"] = {
        mode: newMode,
        playerType: settings.player.playerType,
      };

      updatedPlayer.single = {
        transitionDuration:
          settings.player.single?.transitionDuration ??
          DEFAULT_TRANSITION_DURATION,
      };

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
      {playerModes.map((mode) => {
        const Icon = modeIcons[mode.value];
        return (
          <ToggleGroupItem
            className="cursor-pointer px-4"
            key={mode.value}
            value={mode.value}
          >
            <Icon />
            <span className="hidden sm:block">{mode.label}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
