/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { VolumeControl } from "@/components/audio/volume-control";
import {
  getAudioContextManager,
  resumeAudioContext,
} from "@/lib/audio/playback/audio-context";
import { useMasterPeakLevel } from "@/lib/hooks/use-master-peak-level";
import { useNodeSession } from "@/lib/hooks/use-node-session";
import { PeakMeter } from "../dj/shared/peak-meter";

/** The raw context state; iOS reports "interrupted" after a call or Siri. */
function readContextState(): string | null {
  return getAudioContextManager().getPerformanceSnapshot()?.state ?? null;
}

function useAudioContextState(): string | null {
  const [state, setState] = useState(readContextState);
  useEffect(
    () =>
      getAudioContextManager().onStateChange(() =>
        setState(readContextState())
      ),
    []
  );
  return state;
}

/** Post-master stereo level, from the main output's MeterService tap. */
function MasterMeter() {
  const level = useMasterPeakLevel();
  return (
    <div title="Master level">
      <PeakMeter
        compact
        left={level.left}
        orientation="horizontal"
        right={level.right}
      />
    </div>
  );
}

/**
 * The main bus controls the Speakers node and the Stage share: Play all /
 * Pause all, master volume and mute, a meter while anything plays, and
 * Resume when the browser interrupted the audio. Kept free of React Flow so
 * the Stage can render it without the canvas chunk.
 */
export function NodeMasterControls({ className }: { className?: string }) {
  const {
    masterMuted,
    masterVolume,
    pauseAll,
    playAll,
    playingCount,
    setMasterVolume,
    sources,
    toggleMasterMute,
  } = useNodeSession();
  const contextState = useAudioContextState();
  const isAnyPlaying = playingCount > 0;
  const needsResume =
    contextState === "interrupted" ||
    (contextState === "suspended" && isAnyPlaying);
  const handleResume = () => {
    resumeAudioContext().catch((error: unknown) => {
      console.warn("[NodeMode] Could not resume audio", error);
    });
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button
        className="w-full text-xs"
        disabled={sources.length === 0}
        onClick={isAnyPlaying ? pauseAll : playAll}
        size="sm"
        variant="outline"
      >
        {isAnyPlaying ? (
          <>
            <PauseIcon className="size-3.5" />
            Pause all ({playingCount})
          </>
        ) : (
          <>
            <PlayIcon className="size-3.5" />
            Play all ({sources.length})
          </>
        )}
      </Button>
      <VolumeControl
        isMuted={masterMuted}
        onToggleMute={toggleMasterMute}
        onVolumeChange={setMasterVolume}
        target="all"
        volume={masterVolume}
      />
      {isAnyPlaying ? <MasterMeter /> : null}
      {needsResume ? (
        <Button
          className="w-full text-xs"
          onClick={handleResume}
          size="sm"
          variant="secondary"
        >
          Resume audio
        </Button>
      ) : null}
    </div>
  );
}
