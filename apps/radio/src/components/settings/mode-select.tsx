import {
  ToggleGroup,
  ToggleGroupItem,
} from "@avoid.quest/ui/components/toggle-group";
import { cn } from "@avoid.quest/ui/lib/utils";
import { LayersIcon, ListMusicIcon, SwordsIcon } from "lucide-react";
import { toast } from "sonner";
import { cleanupAudioOnly } from "src/lib/dj-actions";
import { updatePlayerSettings } from "@/lib/collections";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { useSettings } from "@/lib/hooks/use-settings";
import { playerModes } from "@/lib/types";

const modeIcons = {
  multiple: LayersIcon,
  single: ListMusicIcon,
  dj: SwordsIcon,
} as const;

export function ModeSelect({ className }: { className?: string }) {
  const { data: settings } = useSettings();

  const handleModeChange = async (value: string) => {
    if (!settings) {
      return;
    }

    try {
      // Stop audio before switching modes (preserves persisted radio state)
      await cleanupAudioOnly();

      const newMode = value as "single" | "multiple" | "dj";

      updatePlayerSettings((player) => ({
        mode: newMode,
        playerType: player.playerType,
        single: {
          transitionDuration:
            player.single?.transitionDuration ?? DEFAULT_TRANSITION_DURATION,
        },
      }));
    } catch (error) {
      console.error("Failed to update mode:", error);
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
