// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@avoid.quest/ui/components/toggle-group";
import { cn } from "@avoid.quest/ui/lib/utils";
import { LayersIcon, ListMusicIcon, SwordsIcon } from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/lib/hooks/use-settings";
import { playerModes } from "@/lib/types";
import { useModeTransitionSnapshot } from "@/lib/use-mode-transition-snapshot";

const modeIcons = {
  dj: SwordsIcon,
  multiple: LayersIcon,
  single: ListMusicIcon,
} as const;

export function ModeSelect({ className }: { className?: string }) {
  const { data: settings, isReady } = useSettings();
  const modeTransition = useModeTransitionSnapshot();
  const isTransitioning =
    modeTransition.phase === "activating" ||
    modeTransition.phase === "deactivating";

  const handleModeChange = async (value: string) => {
    if (!settings) {
      return;
    }

    try {
      const { modeLifecycleRequests } = await import(
        "@/lib/mode-lifecycle-requests"
      );
      await modeLifecycleRequests.requestMode(value);
    } catch {
      toast.error("Couldn't switch mode");
    }
  };

  if (!isReady) {
    return <Skeleton className={cn("h-7 w-full max-w-xs", className)} />;
  }

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
            aria-label={mode.label}
            className="h-7 cursor-pointer gap-1.5 px-3 text-xs"
            disabled={isTransitioning}
            key={mode.value}
            title={mode.label}
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
