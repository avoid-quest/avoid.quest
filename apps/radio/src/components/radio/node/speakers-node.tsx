/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { PauseIcon, PlayIcon, SpeakerIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { VolumeControl } from "@/components/audio/volume-control";
import {
  getAudioContextManager,
  resumeAudioContext,
} from "@/lib/audio/playback/audio-context";
import { useMasterPeakLevel } from "@/lib/hooks/use-master-peak-level";
import { useNodeSession } from "@/lib/hooks/use-node-session";
import type { GraphNode } from "@/lib/node-graph/schema";
import { AUDIO_IN_HANDLE } from "@/lib/node-graph/templates";
import { PeakMeter } from "../dj/shared/peak-meter";
import {
  type FlowNode,
  type FlowNodeProps,
  Handle,
  Position,
} from "./flow-adapter";

type SpeakersData = Extract<GraphNode, { type: "speakers" }>["data"];
export type SpeakersFlowNode = FlowNode<SpeakersData, "speakers">;

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
 * The main bus: Play all / Pause all, master volume and mute, a meter while
 * anything plays, and Resume when the browser interrupted the audio.
 */
export function SpeakersNode({ selected }: FlowNodeProps<SpeakersFlowNode>) {
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
    <>
      <Handle
        aria-label="Speakers audio in"
        className="node-port"
        id={AUDIO_IN_HANDLE}
        position={Position.Left}
        title="Audio in"
        type="target"
      />
      <div
        className={cn(
          "w-50 rounded-md border bg-card text-card-foreground",
          selected ? "border-ring" : "border-border/50"
        )}
      >
        <div className="flex h-8 items-center gap-2 px-2">
          <span className="flex size-6 items-center justify-center rounded-sm bg-muted text-muted-foreground">
            <SpeakerIcon aria-hidden="true" className="size-3.5" />
          </span>
          <span className="font-medium text-xs">Speakers</span>
        </div>
        <div className="nodrag nopan nowheel flex flex-col gap-2 border-border/50 border-t bg-muted/30 p-2">
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
      </div>
    </>
  );
}
