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
import { MicIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { VolumeControl } from "@/components/audio/volume-control";
import type { ChannelSelection } from "@/lib/audio";
import { laneChannelId } from "@/lib/node-graph/compile";
import { setDeviceParams } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import { getNodePlayback } from "@/lib/node-playback";
import { usePlaybackChannelRuntimeView } from "@/lib/stores/playback-runtime-store";
import { BrowserAudioHelp } from "../browser-audio-form";
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
import type { AudioInputNodeData } from "./flow-elements";
import { INTERACTIVE, keepControlKeys } from "./module-frame";
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
 * device, and Go live / Pause input with a Paused / Live badge. While its audio
 * reaches an output, an amber note says to use headphones, beside the
 * browser's echo cancellation. Going live is never restored after a
 * reload; the mic opens only from Go live.
 */

export const AUDIO_INPUT_NAME = "Audio input";

type AudioInputBodyProps = {
  data: AudioInputNodeData;
  devices: NodeDevices;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  selected?: boolean;
  embedded?: boolean;
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
  devices,
  unplugged,
}: {
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
  if (devices.inputsListed && devices.inputs.length === 0) {
    return (
      <DeviceNote>No audio inputs found. Connect one, then refresh.</DeviceNote>
    );
  }
  return null;
}

function inputAvailability(data: AudioInputNodeData, devices: NodeDevices) {
  const isDisplay = data.capture === "display";
  const denied = !isDisplay && devices.permissionState === "denied";
  const unplugged =
    !isDisplay &&
    isUnplugged(data.deviceId, devices.inputs, devices.inputsListed);
  const canGoLive = data.deviceId !== null && !denied && !unplugged;
  const showDeviceControls =
    !(isDisplay || denied) &&
    (devices.permissionState === "granted" || devices.inputs.length > 0);
  return { canGoLive, denied, isDisplay, showDeviceControls, unplugged };
}

function InputSetup({
  data,
  devices,
  embedded,
  onPickDevice,
  onChannelsChange,
  onEchoCancellationChange,
}: Pick<
  AudioInputBodyProps,
  | "data"
  | "devices"
  | "embedded"
  | "onPickDevice"
  | "onChannelsChange"
  | "onEchoCancellationChange"
>) {
  const { isDisplay, unplugged, canGoLive, showDeviceControls } =
    inputAvailability(data, devices);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
      <div
        className={cn(
          "flex flex-col gap-2 border-border/50 border-t bg-muted/30 px-2 py-2",
          embedded && "border-0 bg-transparent px-0 pt-0",
          INTERACTIVE
        )}
        onKeyDown={keepControlKeys}
      >
        {isDisplay ? (
          <BrowserAudioHelp
            key={data.sourceUrl}
            showRadios={data.deviceLabel === "Radio episodes / shows"}
            url={data.sourceUrl}
          />
        ) : (
          <InputState devices={devices} unplugged={unplugged} />
        )}
        {showDeviceControls ? (
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
            {data.deviceId !== null && !unplugged ? (
              <InputChannelSelect
                onChange={onChannelsChange}
                value={data.channelSelection}
              />
            ) : null}
          </>
        ) : null}
        {data.feedsOutput && canGoLive && !isDisplay ? (
          <FeedbackGuard
            echoCancellation={data.echoCancellation}
            onEchoCancellationChange={onEchoCancellationChange}
          />
        ) : null}
      </div>
    </>
  );
}

export function AudioInputNodeBody({
  data,
  devices,
  isPlaying,
  isLoading,
  error,
  selected = false,
  embedded = false,
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
  const isLive = isPlaying && !isLoading;
  const { denied, unplugged, canGoLive } = inputAvailability(data, devices);

  return (
    <div
      className={cn(
        "w-60 rounded-md border bg-card text-card-foreground",
        isLive ? "border-foreground/40" : "border-border/50",
        selected && "border-ring",
        embedded && "w-full border-0 bg-transparent"
      )}
    >
      <div
        className={cn(
          "flex h-8 items-center gap-1.5 pr-1 pl-2",
          embedded && "hidden"
        )}
      >
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
        <InputLiveBadge isLive={isLive} isLoading={isLoading} />
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
      <InputSetup
        data={data}
        devices={devices}
        embedded={embedded}
        onChannelsChange={onChannelsChange}
        onEchoCancellationChange={onEchoCancellationChange}
        onPickDevice={onPickDevice}
      />
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
      {embedded ? (
        <Button
          className={cn("mt-2 text-destructive", INTERACTIVE)}
          onClick={onRemove}
          onKeyDown={keepControlKeys}
          size="sm"
          variant="ghost"
        >
          <Trash2Icon />
          Remove audio input
        </Button>
      ) : null}
      {error?.trim() && !denied && !unplugged ? (
        <InlineError className="mx-2 mb-2">{error}</InlineError>
      ) : null}
    </div>
  );
}

/** The Audio input's controls, shared by the patch and inspector. */
export function AudioInputNodeContent({
  id,
  data,
  selected,
  store = nodeStore,
  showStrip = true,
}: {
  id: string;
  data: AudioInputNodeData;
  selected?: boolean;
  store?: NodeStore;
  showStrip?: boolean;
}) {
  const actions = useNodeActions();
  const playback = getNodePlayback();
  const devices = useNodeDevices();
  const runtime = usePlaybackChannelRuntimeView(laneChannelId(id));
  const isPlaying = runtime?.isPlaying ?? false;
  const isLoading = runtime?.isLoading ?? false;
  useUnpluggedPause(
    data.capture !== "display" &&
      isUnplugged(data.deviceId, devices.inputs, devices.inputsListed),
    isPlaying,
    () => {
      playback.setPlaying(id, false);
    }
  );
  const commit = (patch: Parameters<typeof setDeviceParams>[2]) => {
    commitNodeGraph(
      (graph) => setDeviceParams(graph, id, patch),
      store,
      "snapshot"
    );
  };
  const title = (data.deviceId && data.deviceLabel) || AUDIO_INPUT_NAME;

  return (
    <AudioInputNodeBody
      data={data}
      devices={devices}
      embedded={!showStrip}
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
        snapshotNodeGraph(store);
      }}
      onVolumeChange={(volume) => playback.setVolume(id, volume)}
      onVolumeCommit={() => snapshotNodeGraph(store)}
      selected={selected}
      strip={
        data.deviceId === null || !showStrip ? null : (
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
  );
}
