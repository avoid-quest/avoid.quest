// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers

import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { toast } from "@avoid.quest/ui/components/sonner";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@avoid.quest/ui/components/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@avoid.quest/ui/components/tooltip";
import { cn } from "@avoid.quest/ui/lib/utils";
import { CableIcon, ListMusicIcon, SwordsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { DjWorkflowLoadError } from "@/lib/dj-workflow-load-error";
import { useSettings } from "@/lib/hooks/use-settings";
import { normalizePlayerMode } from "@/lib/normalize-player-mode";
import { playerModes } from "@/lib/types";
import { useModeTransitionSnapshot } from "@/lib/use-mode-transition-snapshot";

const modeIcons = {
  dj: SwordsIcon,
  node: CableIcon,
  single: ListMusicIcon,
} as const;

export function ModeSelect({ className }: { className?: string }) {
  const { data: settings, isReady } = useSettings();
  const modeTransition = useModeTransitionSnapshot();
  const isTransitioning =
    modeTransition.phase === "activating" ||
    modeTransition.phase === "deactivating";

  const [requestedMode, setRequestedMode] = useState<string | null>(null);
  const pendingMode =
    requestedMode ?? (isTransitioning ? modeTransition.requestedMode : null);
  const [spinnerMode, setSpinnerMode] = useState<string | null>(null);
  useEffect(() => {
    setSpinnerMode(null);
    if (!pendingMode) {
      return;
    }
    const timer = setTimeout(() => setSpinnerMode(pendingMode), 150);
    return () => clearTimeout(timer);
  }, [pendingMode]);

  const handleModeChange = async (value: string) => {
    if (!(settings && value) || requestedMode || isTransitioning) {
      return;
    }

    setRequestedMode(value);
    try {
      const { modeLifecycleRequests } = await import(
        "@/lib/mode-lifecycle-requests"
      );
      await modeLifecycleRequests.requestMode(value);
    } catch (error) {
      if (!(error instanceof DjWorkflowLoadError)) {
        toast.error("Couldn't switch mode");
      }
    } finally {
      setRequestedMode(null);
    }
  };

  if (!isReady) {
    return <Skeleton className={cn("h-7 w-full max-w-xs", className)} />;
  }

  return (
    <ToggleGroup
      aria-label="Playback mode"
      className={cn("w-full max-w-xs", className)}
      onValueChange={handleModeChange}
      type="single"
      value={
        modeTransition.currentMode ??
        // With no mode running, a mode that is starting is the selection,
        // even though the settings still name the one that failed.
        modeTransition.requestedMode ??
        (modeTransition.error ? "" : normalizePlayerMode(settings?.player.mode))
      }
      variant="outline"
    >
      {playerModes.map((mode) => {
        const Icon = modeIcons[mode.value];
        return (
          <Tooltip key={mode.value}>
            {/* Item outside the tooltip, so its on/off data-state is kept. */}
            <ToggleGroupItem
              aria-busy={pendingMode === mode.value || undefined}
              aria-label={mode.label}
              asChild
              className="h-7 cursor-pointer gap-1.5 px-3 text-xs"
              disabled={isTransitioning || requestedMode !== null}
              value={mode.value}
            >
              <TooltipTrigger>
                {spinnerMode === mode.value && pendingMode === mode.value ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <Icon className="size-3.5" />
                )}
                <span className="hidden font-mono text-[10px] uppercase tracking-wider sm:block">
                  {mode.label}
                </span>
              </TooltipTrigger>
            </ToggleGroupItem>
            {/* Names the icon only while the label is hidden. */}
            <TooltipContent className="sm:hidden" side="bottom" sideOffset={6}>
              {mode.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
}
