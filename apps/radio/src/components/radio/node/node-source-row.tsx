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
import { setDeviceParams } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import type { NodeGraph } from "@/lib/node-graph/schema";
import {
  isLocalFileGone,
  isTrackRadio,
  trackSubtitle,
} from "@/lib/node-graph/sources";
import type { NodePlayback } from "@/lib/node-playback";
import { isDeviceInputMetadata } from "@/lib/platform-types";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { InlineError } from "../inline-error";
import { RadioListItemMetadata } from "../radio-list-item-metadata";
import {
  StationRowSubtitle,
  StationRowText,
  stationFallbackSubtitle,
  stationRowButtonOnlyClassName,
  stationRowClassName,
} from "../station-row";
import {
  FeedbackGuard,
  InputLiveBadge,
  InputLiveButton,
  useUnpluggedPause,
} from "./audio-input-controls";
import { useNodeActions } from "./node-actions";
import { isUnplugged, useNodeDevices } from "./use-node-devices";

/** What a Stage or Rack row drives on its lane. */
export type NodeLaneControls = Pick<
  NodePlayback,
  "setPlaying" | "setVolume" | "toggleMute"
>;

type NodeSourceRowProps = {
  nodeId: string;
  /** The lane's channel radio: a station, or an Audio input's device. */
  radio: Radio;
  volume: number;
  muted: boolean;
  controls: NodeLaneControls;
  /**
   * Set on an Audio input whose audio reaches an output: the feedback
   * guard shows, with its echo cancellation.
   */
  feedback?: { echoCancellation: boolean } | null;
  /** Trailing controls, e.g. the station menu. */
  actions?: ReactNode;
  /** The compact channel strip, under the row. */
  strip?: ReactNode;
  /** Shown under the row, e.g. the lane's FX. */
  children?: ReactNode;
};

/**
 * One source lane as a station row, plus whatever the view adds (a menu,
 * its compact channel strip, FX chips): a Station with play, name, now
 * playing and volume (a Track or File with where it comes from instead of
 * now playing), or an Audio input with Go live, its device, Off / Live and
 * volume. Live state comes from the runtime store by lane channel, as on
 * the canvas node.
 */
export function NodeSourceRow(props: NodeSourceRowProps) {
  return isDeviceInputMetadata(props.radio.platformMetadata) ? (
    <InputSourceRow {...props} />
  ) : (
    <StationSourceRow {...props} />
  );
}

/** What an Audio input row says under its name. */
function inputSubtitle(
  permission: string,
  unplugged: boolean,
  isLive: boolean
): string {
  if (permission === "denied") {
    return "Microphone blocked. Allow it in your browser settings.";
  }
  if (unplugged) {
    return "Unplugged: plug it back in or pick another";
  }
  return isLive ? "Audio input, live" : "Audio input";
}

/** An Audio input lane: Go live or Mute, its device, Off / Live, volume. */
function InputSourceRow({
  nodeId,
  radio,
  volume,
  muted,
  controls,
  feedback,
  actions,
  strip,
  children,
}: NodeSourceRowProps) {
  const runtime = useStore(
    playbackRuntimeStore,
    (state) => state.channels[laneChannelId(nodeId)]
  );
  const devices = useNodeDevices();
  const isPlaying = runtime?.isPlaying ?? false;
  const isLoading = runtime?.isLoading ?? false;
  const error = runtime?.error?.message?.trim();
  const isLive = isPlaying && !isLoading;
  const metadata = radio.platformMetadata;
  const deviceId = isDeviceInputMetadata(metadata) ? metadata.deviceId : null;
  const isDisplay =
    isDeviceInputMetadata(metadata) && metadata.capture === "display";
  const unplugged =
    !isDisplay && isUnplugged(deviceId, devices.inputs, devices.inputsListed);
  const denied = !isDisplay && devices.permissionState === "denied";
  useUnpluggedPause(unplugged, isPlaying, () => {
    controls.setPlaying(nodeId, false);
  });

  return (
    <div
      className={cn(
        stationRowClassName,
        "flex-col items-stretch gap-1.5",
        isLive && "bg-muted/40"
      )}
      data-node-id={nodeId}
    >
      <div className="flex min-w-0 items-center gap-2">
        <InputLiveButton
          compact
          disabled={!isPlaying && (denied || unplugged)}
          isLoading={isLoading}
          isPlaying={isPlaying}
          onToggle={() => {
            controls.setPlaying(nodeId, !isPlaying);
          }}
          target={radio.name}
        />
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <StationRowText
            indicator={<InputLiveBadge isLive={isLive} />}
            title={radio.name}
          >
            <StationRowSubtitle>
              {isDisplay
                ? "Shared tab / computer audio"
                : inputSubtitle(devices.permissionState, unplugged, isLive)}
            </StationRowSubtitle>
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
      {strip ? <div className="pl-9">{strip}</div> : null}
      {feedback && !isDisplay ? (
        <FeedbackGuard
          echoCancellation={feedback.echoCancellation}
          onEchoCancellationChange={(echoCancellation) => {
            commitNodeGraph(
              (graph) => setDeviceParams(graph, nodeId, { echoCancellation }),
              nodeStore,
              "snapshot"
            );
          }}
        />
      ) : null}
      {children}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}

/**
 * A Station lane: play, name and now playing, volume. Metadata polls only
 * while the lane plays.
 */
function StationSourceRow({
  nodeId,
  radio,
  volume,
  muted,
  controls,
  actions,
  strip,
  children,
}: NodeSourceRowProps) {
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
  // A Track or File has no now playing to fetch; its subtitle says where
  // it comes from.
  const isTrack = isTrackRadio(radio);
  const { metadata } = useRadioMetadata({
    enabled: !isTrack && (isPlaying || hasEnteredViewport),
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
                  {isTrack
                    ? trackSubtitle(radio)
                    : stationFallbackSubtitle(radio)}
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
      {strip ? <div className="pl-9">{strip}</div> : null}
      {children}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}

/** Files from an earlier page whose picked file is gone until picked again. */
export function repickFiles(
  graph: NodeGraph | null
): { id: string; radio: Radio }[] {
  return (graph?.nodes ?? []).flatMap((node) =>
    node.type === "file" && node.data.radio && isLocalFileGone(node.data.radio)
      ? [{ id: node.id, radio: node.data.radio }]
      : []
  );
}

/**
 * A local file from an earlier page has no lane until it is picked again:
 * the row shows its File on the Patch, where the file form is.
 */
export function RepickFileRow({
  nodeId,
  radio,
  inspect = false,
}: {
  nodeId: string;
  radio: Radio;
  inspect?: boolean;
}) {
  const actions = useNodeActions();
  return (
    <li>
      <button
        className={cn(stationRowButtonOnlyClassName, "opacity-60")}
        onClick={() =>
          inspect ? actions.inspectNode(nodeId) : actions.revealNode(nodeId)
        }
        type="button"
      >
        <StationRowText title={radio.name}>
          <StationRowSubtitle>
            Pick the file again on its File.
          </StationRowSubtitle>
        </StationRowText>
      </button>
    </li>
  );
}
