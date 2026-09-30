/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useStore } from "@tanstack/react-store";
import { MicIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { VolumeControl } from "@/components/audio/volume-control";
import type { ChannelSelection } from "@/lib/audio";
import { findPort } from "@/lib/node-graph/catalogue";
import { laneChannelId } from "@/lib/node-graph/compile";
import { setDeviceParams } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import { getNodePlayback } from "@/lib/node-playback";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { InlineError } from "../inline-error";
import {
  DeviceNote,
  DeviceSelect,
  FeedbackGuard,
  InputChannelSelect,
  InputLiveBadge,
  InputLiveButton,
  useUnpluggedPause,
} from "./audio-input-controls";
import { type FlowNode, type FlowNodeProps, Position } from "./flow-adapter";
import type { AudioInputNodeData } from "./flow-elements";
import { INTERACTIVE, keepControlKeys, NodePort } from "./module-frame";
import { useNodeActions } from "./node-actions";
import { NodeCompactStrip } from "./node-source-strip";
import {
  isUnplugged,
  type NodeDevice,
  type NodeDevices,
  useNodeDevices,
} from "./use-node-devices";

/**
 * Audio Input Node
 *
 * A mic or line-in as a source, through the device path DJ decks use. Its
 * body walks the states a live input goes through: the mic to allow (a
 * gesture), a blocked mic, the device and its channels, an unplugged
 * device, and Go live / Mute with an Off / Live badge. While its audio
 * reaches an output, an amber note says to use headphones, beside the
 * browser's echo cancellation. Going live is never restored after a
 * reload; the mic opens only from Go live.
 */

export type AudioInputFlowNode = FlowNode<AudioInputNodeData, "deviceIn">;

const AUDIO_OUT = findPort("deviceIn", "out", "audio", "main");

export const AUDIO_INPUT_NAME = "Audio input";

type AudioInputBodyProps = {
  data: AudioInputNodeData;
  devices: NodeDevices;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  selected?: boolean;
  onPickDevice: (device: NodeDevice) => void;
  onChannelsChange: (selection: ChannelSelection) => void;
  onEchoCancellationChange: (enabled: boolean) => void;
  onToggleLive: () => void;
  onVolumeChange: (volume: number) => void;
  onVolumeCommit?: () => void;
  onToggleMute: () => void;
  onRemove: () => void;
  /** The compact channel strip under Go live and the fader. */
  strip?: React.ReactNode;
};

/** What the body says about the mic permission and the device, if anything. */
function InputState({
  data,
  devices,
  unplugged,
}: {
  data: AudioInputNodeData;
  devices: NodeDevices;
  unplugged: boolean;
}) {
  if (devices.permissionState === "denied") {
    return (
      <InlineError>
        Microphone blocked. Allow it in your browser settings.
      </InlineError>
    );
  }
  if (devices.permissionState !== "granted") {
    return (
      <Button
        className="h-7 w-full text-xs"
        disabled={devices.isLoading}
        onClick={() => {
          devices.requestPermission();
        }}
        size="sm"
        variant="outline"
      >
        {devices.isLoading ? <Spinner /> : <MicIcon />}
        Allow microphone
      </Button>
    );
  }
  if (unplugged) {
    return (
      <DeviceNote tone="warning">
        Unplugged: plug it back in or pick another
      </DeviceNote>
    );
  }
  if (data.deviceId === null) {
    return <DeviceNote>Pick the input to play</DeviceNote>;
  }
  return null;
}

export function AudioInputNodeBody({
  data,
  devices,
  isPlaying,
  isLoading,
  error,
  selected = false,
  onPickDevice,
  onChannelsChange,
  onEchoCancellationChange,
  onToggleLive,
  onVolumeChange,
  onVolumeCommit,
  onToggleMute,
  onRemove,
  strip,
}: AudioInputBodyProps) {
  const title = (data.deviceId && data.deviceLabel) || AUDIO_INPUT_NAME;
  const denied = devices.permissionState === "denied";
  const unplugged = isUnplugged(
    data.deviceId,
    devices.inputs,
    devices.inputsListed
  );
  const isLive = isPlaying && !isLoading;
  const canGoLive = data.deviceId !== null && !denied && !unplugged;

  return (
    <div
      className={cn(
        "w-60 rounded-md border bg-card text-card-foreground",
        isLive ? "border-foreground/40" : "border-border/50",
        selected && "border-ring"
      )}
    >
      <div className="flex h-8 items-center gap-1.5 pr-1 pl-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-sm",
            isLive
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          <MicIcon aria-hidden="true" className="size-3.5" />
        </span>
        <span
          className="min-w-0 flex-1 truncate font-medium text-xs"
          title={title}
        >
          {title}
        </span>
        <InputLiveBadge isLive={isLive} />
        {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
        <div className={INTERACTIVE} onKeyDown={keepControlKeys}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`Options for ${title}`}
                className="size-6 text-muted-foreground"
                size="icon"
                variant="ghost"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRemove} variant="destructive">
                <Trash2Icon />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
      <div
        className={cn(
          "flex flex-col gap-2 border-border/50 border-t bg-muted/30 px-2 py-2",
          INTERACTIVE
        )}
        onKeyDown={keepControlKeys}
      >
        <InputState data={data} devices={devices} unplugged={unplugged} />
        {denied ? null : (
          <>
            <DeviceSelect
              devices={devices.inputs}
              isLoading={devices.isLoading}
              label="Audio input device"
              onChange={onPickDevice}
              onRefresh={() => {
                devices.refreshDevices();
              }}
              placeholder={
                unplugged ? data.deviceLabel || "Unplugged" : "Choose an input"
              }
              value={data.deviceId}
            />
            <InputChannelSelect
              onChange={onChannelsChange}
              value={data.channelSelection}
            />
          </>
        )}
        {data.feedsOutput && !denied ? (
          <FeedbackGuard
            echoCancellation={data.echoCancellation}
            onEchoCancellationChange={onEchoCancellationChange}
          />
        ) : null}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
      <div
        className={cn(
          "flex flex-col gap-1 rounded-b-[inherit] border-border/50 border-t px-2 py-1.5",
          INTERACTIVE
        )}
        onKeyDown={keepControlKeys}
      >
        <div className="flex items-center gap-2">
          <InputLiveButton
            disabled={!(canGoLive || isPlaying)}
            isLoading={isLoading}
            isPlaying={isPlaying}
            onToggle={onToggleLive}
            target={title}
          />
          <VolumeControl
            className="flex-1"
            isMuted={data.muted || data.volume === 0}
            onToggleMute={onToggleMute}
            onVolumeChange={onVolumeChange}
            onVolumeCommit={onVolumeCommit}
            target={title}
            volume={data.volume}
          />
        </div>
        {strip}
      </div>
      {error?.trim() ? (
        <InlineError className="mx-2 mb-2">{error}</InlineError>
      ) : null}
    </div>
  );
}

/** The Audio input on the canvas: its body plus its one port, audio out. */
export function AudioInputNode({
  id,
  data,
  selected,
}: FlowNodeProps<AudioInputFlowNode>) {
  const actions = useNodeActions();
  const playback = getNodePlayback();
  const devices = useNodeDevices();
  const runtime = useStore(
    playbackRuntimeStore,
    (state) => state.channels[laneChannelId(id)]
  );
  const isPlaying = runtime?.isPlaying ?? false;
  const isLoading = runtime?.isLoading ?? false;
  useUnpluggedPause(
    isUnplugged(data.deviceId, devices.inputs, devices.inputsListed),
    isPlaying,
    () => {
      playback.setPlaying(id, false);
    }
  );
  const commit = (patch: Parameters<typeof setDeviceParams>[2]) => {
    commitNodeGraph(
      (graph) => setDeviceParams(graph, id, patch),
      nodeStore,
      "snapshot"
    );
  };
  const title = (data.deviceId && data.deviceLabel) || AUDIO_INPUT_NAME;

  return (
    <>
      <AudioInputNodeBody
        data={data}
        devices={devices}
        error={runtime?.error?.message ?? null}
        isLoading={isLoading}
        isPlaying={isPlaying}
        onChannelsChange={(channelSelection) => commit({ channelSelection })}
        onEchoCancellationChange={(echoCancellation) =>
          commit({ echoCancellation })
        }
        onPickDevice={(device) =>
          commit({ deviceId: device.deviceId, deviceLabel: device.label })
        }
        onRemove={() => actions.removeNode(id)}
        onToggleLive={() => {
          playback.setPlaying(id, !isPlaying);
        }}
        onToggleMute={() => {
          playback.toggleMute(id);
          snapshotNodeGraph();
        }}
        onVolumeChange={(volume) => playback.setVolume(id, volume)}
        onVolumeCommit={() => snapshotNodeGraph()}
        selected={selected}
        strip={
          data.deviceId === null ? null : (
            <NodeCompactStrip
              muted={data.muted}
              nodeId={id}
              onInspect={() => actions.inspectNode(id)}
              strip={data.strip}
              target={title}
            />
          )
        }
      />
      {AUDIO_OUT ? (
        <NodePort
          ariaLabel={`${title} audio out`}
          className={cn(isPlaying && !isLoading && "node-port-live")}
          label="Audio out"
          port={AUDIO_OUT}
          position={Position.Right}
          type="deviceIn"
        />
      ) : null}
    </>
  );
}
