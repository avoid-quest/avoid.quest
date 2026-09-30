/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Badge } from "@avoid.quest/ui/components/badge";
import { Button } from "@avoid.quest/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { Switch } from "@avoid.quest/ui/components/switch";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  RefreshCwIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId } from "react";
import {
  buildChannelOptions,
  deserializeSelection,
  serializeSelection,
} from "@/components/radio/dj/deck/deck-panel-sections";
import type { ChannelSelection } from "@/lib/audio";
import type { NodeDevice } from "./use-node-devices";

/**
 * Audio Input Controls
 *
 * The pieces an Audio input shows on the canvas and in the Stage and Rack,
 * in DJ's words: Go live and Mute, Off and Live, the device and its
 * channels. None of them import React Flow, so the Stage and Rack can load
 * them without the canvas chunk.
 */

/** Browsers deliver at most two input channels a device. */
const INPUT_CHANNELS = 2;

/** A one-line note in a device body: a warning in the Key amber, or a hint. */
export function DeviceNote({
  tone = "hint",
  className,
  children,
}: {
  tone?: "hint" | "warning";
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-md px-2.5 py-1.5 text-xs",
        tone === "warning"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "bg-muted/50 text-muted-foreground",
        className
      )}
      role={tone === "warning" ? "status" : undefined}
    >
      {children}
    </p>
  );
}

/** Off or Live, as a DJ deck's input reads. */
export function InputLiveBadge({ isLive }: { isLive: boolean }) {
  return (
    <Badge
      className="shrink-0 px-1.5 py-0 text-[10px]"
      variant={isLive ? "default" : "secondary"}
    >
      {isLive ? "Live" : "Off"}
    </Badge>
  );
}

/** Go live, or Mute while live: DJ's input button. */
export function InputLiveButton({
  target,
  isPlaying,
  isLoading,
  disabled = false,
  compact = false,
  onToggle,
}: {
  /** Names the input for screen readers: "Go live Desk mic". */
  target: string;
  isPlaying: boolean;
  isLoading: boolean;
  disabled?: boolean;
  /** An icon-only button, for a row. */
  compact?: boolean;
  onToggle: () => void;
}) {
  const label = isPlaying ? "Mute" : "Go live";
  const Icon = isPlaying ? MicOffIcon : MicIcon;
  // "Mute live", so it reads apart from the volume's own Mute.
  const name = isPlaying ? `Mute live ${target}` : `Go live ${target}`;
  return (
    <Button
      aria-label={name}
      className={cn(compact ? "size-7 shrink-0" : "h-7 shrink-0 text-xs")}
      disabled={disabled || isLoading}
      onClick={onToggle}
      size={compact ? "icon" : "sm"}
      title={compact ? label : undefined}
      variant={isPlaying ? "outline" : "default"}
    >
      {isLoading ? <Spinner /> : <Icon />}
      {compact ? null : <span>{label}</span>}
    </Button>
  );
}

/** The device picker with DJ's Refresh beside it. */
export function DeviceSelect({
  label,
  placeholder,
  devices,
  value,
  isLoading,
  disabledReason,
  onChange,
  onRefresh,
}: {
  /** The select's accessible name, e.g. "Audio input device". */
  label: string;
  placeholder: string;
  devices: readonly NodeDevice[];
  value: string | null;
  isLoading: boolean;
  /** Why a device can't be picked here, or null when it can. */
  disabledReason?: (deviceId: string) => string | null;
  onChange: (device: NodeDevice) => void;
  onRefresh: () => void;
}) {
  const known = devices.some((device) => device.deviceId === value);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Select
        disabled={isLoading || devices.length === 0}
        onValueChange={(deviceId) => {
          const device = devices.find((entry) => entry.deviceId === deviceId);
          if (device) {
            onChange(device);
          }
        }}
        value={known && value ? value : ""}
      >
        <SelectTrigger aria-label={label} className="min-w-0 flex-1" size="xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {devices.map((device) => {
            const reason = disabledReason?.(device.deviceId) ?? null;
            return (
              <SelectItem
                disabled={reason !== null}
                key={device.deviceId}
                title={reason ?? undefined}
                value={device.deviceId}
              >
                {device.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Button
        aria-label="Refresh devices"
        className="size-7 shrink-0 text-muted-foreground"
        disabled={isLoading}
        onClick={onRefresh}
        size="icon"
        title="Refresh devices"
        variant="ghost"
      >
        <RefreshCwIcon className={isLoading ? "animate-spin" : undefined} />
      </Button>
    </div>
  );
}

/** Which of the device's two channels feed left and right. */
export function InputChannelSelect({
  value,
  onChange,
}: {
  value: ChannelSelection;
  onChange: (selection: ChannelSelection) => void;
}) {
  const id = useId();
  const options = buildChannelOptions(INPUT_CHANNELS);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label
        className="w-14 shrink-0 text-muted-foreground text-xs"
        htmlFor={id}
        title="Browsers give at most 2 channels a device. For others, make an aggregate device in your system's audio settings."
      >
        Channel
      </label>
      <Select
        onValueChange={(key) => onChange(deserializeSelection(key))}
        value={serializeSelection(value)}
      >
        <SelectTrigger
          aria-label="Input channels"
          className="min-w-0 flex-1"
          id={id}
          size="xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The feedback guard, while the input reaches an output: headphones, or
 * the browser's echo cancellation, which colours music.
 */
export function FeedbackGuard({
  echoCancellation,
  onEchoCancellationChange,
}: {
  echoCancellation: boolean;
  onEchoCancellationChange?: (enabled: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-amber-700 text-xs dark:text-amber-400">
      <p className="flex items-center gap-1.5" role="status">
        <HeadphonesIcon aria-hidden="true" className="size-3.5 shrink-0" />
        Use headphones: a mic into speakers can howl
      </p>
      {onEchoCancellationChange ? (
        <div className="flex items-center justify-between gap-2">
          <label
            className="text-foreground"
            htmlFor={id}
            title="The browser's own feedback guard. It also colours music."
          >
            Echo cancellation
          </label>
          <Switch
            checked={echoCancellation}
            id={id}
            onCheckedChange={onEchoCancellationChange}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * An input whose device went away stops: `pause` runs when the device list
 * loses it while it plays.
 */
export function useUnpluggedPause(
  unplugged: boolean,
  isPlaying: boolean,
  pause: () => void
) {
  useEffect(() => {
    if (unplugged && isPlaying) {
      pause();
    }
  }, [unplugged, isPlaying, pause]);
}
