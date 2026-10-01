/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useStore } from "@tanstack/react-store";
import { SlidersHorizontalIcon } from "lucide-react";
import type { Radio } from "@/lib/audio";
import { isSinkIdSupported } from "@/lib/audio/utils";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { useAudioSettings } from "@/lib/hooks/use-settings";
import { isSoloActive, laneChannelId } from "@/lib/node-graph/compile";
import {
  type StripParams,
  setDeviceParams,
  setSourceStrip,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import type {
  SourceStrip as SourceStripData,
  StripSourceNode,
} from "@/lib/node-graph/schema";
import { getNodePlayback } from "@/lib/node-playback";
import { isRadioBrowserMetadata } from "@/lib/platform-types";
import { streamFormatOf } from "@/lib/source-strip";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { RELEASE_DELAY_MS } from "./module-frame";
import {
  CompactSourceStrip,
  SourceStrip,
  type StationDetails,
} from "./source-strip";
import { isUnplugged, useNodeDevices } from "./use-node-devices";

/**
 * Node Source Strip
 *
 * The source strip wired to Node mode: strip edits commit to the patch
 * (a release takes the undo step), mute and transport go to node playback,
 * and the meter, buffering and position follow the lane's sound by its
 * channel in the runtime store.
 */

/**
 * Whether another source's solo silences this one: its meter taps before
 * solo, so the strip says so instead.
 */
function useSoloedOut(solo: boolean, store: NodeStore): boolean {
  return useStore(
    store,
    (state) => !solo && state.graph !== null && isSoloActive(state.graph.nodes)
  );
}

/** The lane's runtime by source node id: its sound and play state. */
export function useLaneRuntime(nodeId: string) {
  return useStore(
    playbackRuntimeStore,
    (state) => state.channels[laneChannelId(nodeId)]
  );
}

function commitStrip(
  nodeId: string,
  patch: StripParams,
  store: NodeStore,
  step: boolean
) {
  commitNodeGraph(
    (graph) => setSourceStrip(graph, nodeId, patch),
    store,
    step ? "snapshot" : undefined
  );
}

/** Knob turns fold into one undo step, taken once the pointer lets go. */
function releaseStep(store: NodeStore) {
  return () => {
    setTimeout(() => snapshotNodeGraph(store), RELEASE_DELAY_MS);
  };
}

/**
 * The compact strip on a source's node body and Rack row, with the
 * button that opens its full strip in the inspector.
 */
export function NodeCompactStrip({
  nodeId,
  target,
  strip,
  muted,
  onInspect,
  onToggleMute = () => getNodePlayback().toggleMute(nodeId),
  className,
  store = nodeStore,
}: {
  nodeId: string;
  target: string;
  strip: SourceStripData;
  muted: boolean;
  onInspect?: () => void;
  /** The source's mute; node playback's unless the view drives its own. */
  onToggleMute?: () => void;
  className?: string;
  store?: NodeStore;
}) {
  const runtime = useLaneRuntime(nodeId);
  const soloedOut = useSoloedOut(strip.solo, store);
  const release = releaseStep(store);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: listens for releases; each control is focusable itself
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: listens for releases; each control is focusable itself
    <div
      className={cn("flex min-w-0 items-center gap-1", className)}
      onKeyUp={release}
      onPointerUp={release}
      onWheelCapture={release}
    >
      <CompactSourceStrip
        className="flex-1"
        muted={muted}
        onPanChange={(pan) => commitStrip(nodeId, { pan }, store, false)}
        onToggleMute={() => {
          onToggleMute();
          snapshotNodeGraph(store);
        }}
        onToggleSolo={() =>
          commitStrip(nodeId, { solo: !strip.solo }, store, true)
        }
        pan={strip.pan}
        solo={strip.solo}
        soloedOut={soloedOut}
        soundId={runtime?.soundId ?? null}
        target={target}
      />
      {onInspect ? (
        <Button
          aria-label={`Channel strip of ${target}`}
          className="size-6 shrink-0 text-muted-foreground"
          data-inspect-node={nodeId}
          onClick={onInspect}
          size="icon"
          title="Channel strip: trim, speed, seek and more"
          variant="ghost"
        >
          <SlidersHorizontalIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

/** A live Station's stream details, from its runtime and metadata. */
function useStationDetails(
  radio: Radio | null,
  nodeId: string
): StationDetails | undefined {
  const runtime = useLaneRuntime(nodeId);
  const isPlaying = runtime?.isPlaying ?? false;
  const { metadata } = useRadioMetadata({
    enabled: radio !== null && isPlaying,
    poll: isPlaying && !runtime?.isLoading,
    radio,
  });
  if (!radio) {
    return undefined;
  }
  const listed = isRadioBrowserMetadata(radio.platformMetadata)
    ? radio.platformMetadata
    : null;
  return {
    bitrate: metadata?.bitrate ?? listed?.bitrate ?? null,
    codec: listed?.codec ?? null,
    format: streamFormatOf(radio, radio.streamUrl),
    isBuffering: runtime?.isBuffering ?? false,
    isPlaying,
  };
}

/** Every strip control the source's kind has, in the inspector. */
export function NodeSourceStripPanel({
  node,
  target,
  store = nodeStore,
  showInputControls = true,
}: {
  node: StripSourceNode;
  target: string;
  store?: NodeStore;
  showInputControls?: boolean;
}) {
  const playback = getNodePlayback();
  const runtime = useLaneRuntime(node.id);
  const soloedOut = useSoloedOut(node.data.strip.solo, store);
  const audioSettings = useAudioSettings();
  const devices = useNodeDevices({
    enabled: node.type === "deviceIn" && showInputControls,
  });
  const radio =
    node.type === "deviceIn" ? null : (node.data.radio as Radio | null);
  const station = useStationDetails(
    node.type === "station" ? radio : null,
    node.id
  );
  const soundId = runtime?.soundId ?? null;
  const isPlaying = runtime?.isPlaying ?? false;
  const deviceCommit = (patch: Parameters<typeof setDeviceParams>[2]) => {
    commitNodeGraph(
      (graph) => setDeviceParams(graph, node.id, patch),
      store,
      "snapshot"
    );
  };

  return (
    <SourceStrip
      input={
        node.type === "deviceIn" && showInputControls
          ? {
              canGoLive:
                node.data.deviceId !== null &&
                devices.permissionState !== "denied" &&
                !isUnplugged(
                  node.data.deviceId,
                  devices.inputs,
                  devices.inputsListed
                ),
              channelSelection: node.data.channelSelection,
              echoCancellation: node.data.echoCancellation,
              isLoading: runtime?.isLoading ?? false,
              isPlaying,
              onChannelsChange: (channelSelection) =>
                deviceCommit({ channelSelection }),
              onEchoCancellationChange: (echoCancellation) =>
                deviceCommit({ echoCancellation }),
              onToggleLive: () => {
                playback.setPlaying(node.id, !isPlaying);
              },
              strip: node.data.strip,
            }
          : undefined
      }
      key={node.id}
      kind={node.type}
      media={
        node.type === "platform" || node.type === "file"
          ? {
              // A cue output needs a device picked and setSinkId to reach.
              canCueListen:
                Boolean(audioSettings.cueOutputId) && isSinkIdSupported(),
              onJumpToCue: () => playback.jumpToCue(node.id),
              onSeek: (position) => playback.seek(node.id, position),
              onSetCue: () => playback.setCue(node.id),
              soundId,
              strip: node.data.strip,
            }
          : undefined
      }
      muted={node.data.muted}
      onStripChange={(patch) => commitStrip(node.id, patch, store, false)}
      onToggleMute={() => {
        playback.toggleMute(node.id);
        snapshotNodeGraph(store);
      }}
      soloedOut={soloedOut}
      soundId={soundId}
      station={station}
      strip={node.data.strip}
      target={target}
    />
  );
}
