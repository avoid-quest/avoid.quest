/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useStore } from "@tanstack/react-store";
import {
  MonitorSpeakerIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import type { DeviceSinkStatus } from "@/lib/audio/routing/node-device-sinks";
import { isSinkIdSupported } from "@/lib/audio/utils";
import { useAudioSettings } from "@/lib/hooks/use-settings";
import { findPort } from "@/lib/node-graph/catalogue";
import { setDeviceParams } from "@/lib/node-graph/graph-edits";
import { commitNodeGraph, nodeStore } from "@/lib/node-graph/node-store";
import { ONE_DEVICE_OUT_MESSAGE } from "@/lib/node-graph/validate";
import { nodeSinkStatuses } from "@/lib/node-playback";
import { InlineError } from "../inline-error";
import { DeviceNote, DeviceSelect } from "./audio-input-controls";
import { type FlowNode, type FlowNodeProps, Position } from "./flow-adapter";
import type { OutputDeviceNodeData } from "./flow-elements";
import { INTERACTIVE, keepControlKeys, NodePort } from "./module-frame";
import { useNodeActions } from "./node-actions";
import {
  isUnplugged,
  type NodeDevice,
  type NodeDevices,
  useNodeDevices,
} from "./use-node-devices";

/**
 * Output Device Node
 *
 * One more output beside Speakers: the cables into it play on the device
 * it names, through `setSinkId`. Speakers stay the app's main output; this
 * only adds another. Where it can't play (no `setSinkId`, a rejected
 * device, an unplugged one) its cables play through Speakers, and its body
 * says so.
 */

export type OutputDeviceFlowNode = FlowNode<OutputDeviceNodeData, "deviceOut">;

const AUDIO_IN = findPort("deviceOut", "in", "audio", "main");

export const OUTPUT_DEVICE_NAME = "Output device";

/** The main output's own id, as the settings store it by default. */
const DEFAULT_OUTPUT_ID = "default";

type OutputDeviceBodyProps = {
  data: OutputDeviceNodeData;
  devices: NodeDevices;
  /** The sink's status from node playback, once it has one. */
  status: DeviceSinkStatus | undefined;
  /** The device Speakers play on (the main output setting). */
  mainOutputId: string;
  /** Whether the browser can choose an output at all. */
  supported: boolean;
  selected?: boolean;
  onPickDevice: (device: NodeDevice) => void;
  onToggleMute: () => void;
  onRemove: () => void;
};

/** What the body says about where its cables play, if anything. */
function OutputState({
  data,
  devices,
  status,
  mainOutputId,
  supported,
}: Omit<OutputDeviceBodyProps, "onPickDevice" | "onToggleMute" | "onRemove">) {
  if (!supported || status?.state === "unsupported") {
    return (
      <DeviceNote tone="warning">
        This browser can't choose an output, playing through Speakers
      </DeviceNote>
    );
  }
  if (
    status?.state === "unplugged" ||
    isUnplugged(data.deviceId, devices.outputs, devices.outputsListed)
  ) {
    return (
      <DeviceNote tone="warning">
        Unplugged, playing through Speakers
      </DeviceNote>
    );
  }
  if (status?.state === "failed") {
    return (
      <InlineError>
        <span title={status.message}>
          Couldn't play here, playing through Speakers
        </span>
      </InlineError>
    );
  }
  if (data.deviceId === null) {
    return <DeviceNote>Pick the output to play on</DeviceNote>;
  }
  if (data.deviceId === mainOutputId) {
    return <DeviceNote>Same device as Speakers</DeviceNote>;
  }
  return null;
}

export function OutputDeviceNodeBody({
  data,
  devices,
  status,
  mainOutputId,
  supported,
  selected = false,
  onPickDevice,
  onToggleMute,
  onRemove,
}: OutputDeviceBodyProps) {
  const title = (data.deviceId && data.deviceLabel) || OUTPUT_DEVICE_NAME;
  const MuteIcon = data.muted ? VolumeXIcon : Volume2Icon;
  const choices = devices.outputs.filter(
    (device) => device.deviceId !== DEFAULT_OUTPUT_ID
  );

  return (
    <div
      className={cn(
        "w-56 rounded-md border bg-card text-card-foreground",
        selected ? "border-ring" : "border-border/50"
      )}
    >
      <div className="flex h-8 items-center gap-1.5 pr-1 pl-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
          <MonitorSpeakerIcon aria-hidden="true" className="size-3.5" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium text-xs",
            data.muted && "text-muted-foreground"
          )}
          title={title}
        >
          {title}
        </span>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
        <div
          className={cn("flex shrink-0 items-center gap-0.5", INTERACTIVE)}
          onKeyDown={keepControlKeys}
        >
          <Button
            aria-label={`${data.muted ? "Unmute" : "Mute"} ${title}`}
            aria-pressed={data.muted}
            className="size-6 text-muted-foreground"
            onClick={onToggleMute}
            size="icon"
            title={data.muted ? "Unmute" : "Mute"}
            variant="ghost"
          >
            <MuteIcon />
          </Button>
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
          "flex flex-col gap-2 rounded-b-[inherit] border-border/50 border-t bg-muted/30 px-2 py-2",
          INTERACTIVE
        )}
        onKeyDown={keepControlKeys}
      >
        <OutputState
          data={data}
          devices={devices}
          mainOutputId={mainOutputId}
          status={status}
          supported={supported}
        />
        {supported ? (
          <>
            {devices.permissionState === "granted" ? null : (
              <Button
                className="h-auto min-h-7 w-full whitespace-normal text-xs"
                disabled={devices.isLoading}
                onClick={() => {
                  devices.requestPermission();
                }}
                size="sm"
                variant="outline"
              >
                Allow access to see device names
              </Button>
            )}
            <DeviceSelect
              devices={choices}
              disabledReason={(deviceId) =>
                data.taken.includes(deviceId) ? ONE_DEVICE_OUT_MESSAGE : null
              }
              isLoading={devices.isLoading}
              label="Output device"
              onChange={onPickDevice}
              onRefresh={() => {
                devices.refreshDevices();
              }}
              placeholder={
                data.deviceId
                  ? data.deviceLabel || "Unplugged"
                  : "Choose an output"
              }
              value={data.deviceId}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The Output device on the canvas: its body plus its one port, audio in. */
export function OutputDeviceNode({
  id,
  data,
  selected,
}: FlowNodeProps<OutputDeviceFlowNode>) {
  const actions = useNodeActions();
  const devices = useNodeDevices();
  // Follows Settings, where the main output (Speakers' device) is picked.
  const { mainOutputId } = useAudioSettings();
  const status = useStore(nodeSinkStatuses, (state) => state[id]);
  const title = (data.deviceId && data.deviceLabel) || OUTPUT_DEVICE_NAME;
  const commit = (patch: Parameters<typeof setDeviceParams>[2]) => {
    commitNodeGraph(
      (graph) => setDeviceParams(graph, id, patch),
      nodeStore,
      "snapshot"
    );
  };

  return (
    <>
      {AUDIO_IN ? (
        <NodePort
          ariaLabel={`${title} audio in`}
          label="Audio in"
          port={AUDIO_IN}
          position={Position.Left}
          type="deviceOut"
        />
      ) : null}
      <OutputDeviceNodeBody
        data={data}
        devices={devices}
        mainOutputId={mainOutputId}
        onPickDevice={(device) =>
          commit({ deviceId: device.deviceId, deviceLabel: device.label })
        }
        onRemove={() => actions.removeNode(id)}
        onToggleMute={() => commit({ muted: !data.muted })}
        selected={selected}
        status={status}
        supported={isSinkIdSupported()}
      />
    </>
  );
}
