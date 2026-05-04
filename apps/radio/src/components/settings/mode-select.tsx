import {
  ToggleGroup,
  ToggleGroupItem,
} from "@avoid.quest/ui/components/toggle-group";
import { cn } from "@avoid.quest/ui/lib/utils";
import { LayersIcon, ListMusicIcon, SwordsIcon } from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/lib/hooks/use-settings";
import {
  isPlaybackSessionId,
  modeManager,
  useModeTransitionSnapshot,
} from "@/lib/mode-lifecycle-manager";
import { playerModes } from "@/lib/types";

const modeIcons = {
  multiple: LayersIcon,
  single: ListMusicIcon,
  dj: SwordsIcon,
} as const;

export function ModeSelect({ className }: { className?: string }) {
  const { data: settings } = useSettings();
  const modeTransition = useModeTransitionSnapshot();
  const isTransitioning =
    modeTransition.phase === "activating" ||
    modeTransition.phase === "deactivating";

  const handleModeChange = async (value: string) => {
    if (!settings) {
      return;
    }

    try {
      if (!isPlaybackSessionId(value)) {
        return;
      }

      await modeManager.switchTo(value);
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
            disabled={isTransitioning}
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
