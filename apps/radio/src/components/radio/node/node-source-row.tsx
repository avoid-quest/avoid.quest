/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useStore } from "@tanstack/react-store";
import { AudioLinesIcon } from "lucide-react";
import type { ReactNode } from "react";
import { VolumeControl } from "@/components/audio/volume-control";
import type { Radio } from "@/lib/audio";
import { useHasEnteredViewport } from "@/lib/hooks/use-has-entered-viewport";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { laneChannelId } from "@/lib/node-graph/compile";
import { snapshotNodeGraph } from "@/lib/node-graph/node-store";
import type { NodePlayback } from "@/lib/node-playback";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { InlineError } from "../inline-error";
import { RadioListItemMetadata } from "../radio-list-item-metadata";
import {
  StationRowSubtitle,
  StationRowText,
  stationFallbackSubtitle,
  stationRowClassName,
} from "../station-row";

/** What a Stage or Rack row drives on its lane. */
export type NodeLaneControls = Pick<
  NodePlayback,
  "setPlaying" | "setVolume" | "toggleMute"
>;

/**
 * One Station lane as a station row: play, name and now playing, volume,
 * plus whatever the view adds (a menu, FX chips). Live state comes from the
 * runtime store by lane channel, as on the canvas node; metadata polls only
 * while the lane plays.
 */
export function NodeSourceRow({
  nodeId,
  radio,
  volume,
  muted,
  controls,
  actions,
  children,
}: {
  nodeId: string;
  radio: Radio;
  volume: number;
  muted: boolean;
  controls: NodeLaneControls;
  /** Trailing controls, e.g. the station menu. */
  actions?: ReactNode;
  /** Shown under the row, e.g. the lane's FX. */
  children?: ReactNode;
}) {
  const runtime = useStore(
    playbackRuntimeStore,
    (state) => state.channels[laneChannelId(nodeId)]
  );
  const isPlaying = runtime?.isPlaying ?? false;
  const isLoading = runtime?.isLoading ?? false;
  const error = runtime?.error?.message?.trim();
  const isLive = isPlaying && !isLoading;
  const { elementRef, hasEnteredViewport } =
    useHasEnteredViewport<HTMLDivElement>();
  const { metadata } = useRadioMetadata({
    enabled: isPlaying || hasEnteredViewport,
    poll: isLive,
    radio,
  });

  return (
    <div
      className={cn(
        stationRowClassName,
        "flex-col items-stretch gap-1.5",
        isLive && "bg-muted/40",
        isSessionRadio(radio) && "border-l-2 border-l-[#00d084]/40"
      )}
      data-node-id={nodeId}
      ref={elementRef}
    >
      <div className="flex min-w-0 items-center gap-2">
        <PlayPauseButton
          className="size-7 shrink-0"
          iconClassName="size-3.5"
          isLoading={isLoading}
          isPlaying={isPlaying}
          label={radio.name}
          onClick={() => {
            controls.setPlaying(nodeId, !isPlaying);
          }}
          size="sm"
          variant={isLive ? "outline" : "default"}
        />
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <StationRowText
            indicator={
              isLive ? (
                <AudioLinesIcon
                  aria-label="Playing"
                  className="size-3.5 shrink-0"
                  role="img"
                />
              ) : null
            }
            title={radio.name}
          >
            <RadioListItemMetadata
              fallback={
                <StationRowSubtitle>
                  {stationFallbackSubtitle(radio)}
                </StationRowSubtitle>
              }
              metadata={metadata}
              radio={radio}
            />
          </StationRowText>
        </div>
        <VolumeControl
          className="w-28 shrink-0"
          isMuted={muted || volume === 0}
          onToggleMute={() => {
            controls.toggleMute(nodeId);
            snapshotNodeGraph();
          }}
          onVolumeChange={(next) => controls.setVolume(nodeId, next)}
          onVolumeCommit={() => snapshotNodeGraph()}
          target={radio.name}
          volume={volume}
        />
        {actions}
      </div>
      {children}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
