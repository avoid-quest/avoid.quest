import {
  ToggleGroup,
  ToggleGroupItem,
} from "@avoid.quest/ui/components/toggle-group";
import { cn } from "@avoid.quest/ui/lib/utils";
import { LayersIcon, ListMusicIcon, SwordsIcon } from "lucide-react";
import { toast } from "sonner";
import { HTML5AudioManager } from "@/lib/audio/html5";
import { updatePlayerSettings } from "@/lib/collections";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { cleanupAudioOnly } from "@/lib/dj-actions";
import { useSettings } from "@/lib/hooks/use-settings";
import { cleanupAudioForModeChange } from "@/lib/playback-actions";
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
      const newMode = value as "single" | "multiple" | "dj";
      await cleanupAudioOnly();
      HTML5AudioManager.getInstance().dispose();
      await cleanupAudioForModeChange(newMode);

      updatePlayerSettings((player) => ({
        mode: newMode,
        single: {
          transitionDuration:
            player.single?.transitionDuration ?? DEFAULT_TRANSITION_DURATION,
        },
      }));
    } catch {
      toast.error("Failed to update mode");
    }
  };

  return (
    <ToggleGroup
      className={cn("w-full max-w-xs", className)}
      onValueChange={handleModeChange}
      type="single"
      value={settings?.player.mode || "single"}
      variant="outline"
    >
      {playerModes.map((mode) => {
        const Icon = modeIcons[mode.value];
        return (
          <ToggleGroupItem
            className="h-7 cursor-pointer gap-1.5 px-3 text-xs"
            key={mode.value}
            value={mode.value}
          >
            <Icon className="size-3.5" />
            <span className="hidden font-mono text-[10px] uppercase tracking-wider sm:block">
              {mode.label}
            </span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
