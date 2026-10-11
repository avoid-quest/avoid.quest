/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { XIcon } from "lucide-react";
import { VolumeControl } from "@/components/audio/volume-control";
import { laneChannelId } from "@/lib/node-graph/compile";
import { snapshotNodeGraph } from "@/lib/node-graph/node-store";
import { getNodePlayback } from "@/lib/node-playback";
import { usePlaybackChannelRuntimeView } from "@/lib/stores/playback-runtime-store";
import { INTERACTIVE, keepControlKeys } from "./module-frame";

/**
 * Source Node Frame
 *
 * The frame a Station, Track and File share: one card width, a dashed
 * empty slot whose body is how it fills (search, platform search, file
 * form), the play and volume strip with the compact channel strip under
 * it, and the one audio out port. They take
 * the same place on the canvas, so swapping one for another (a radio link
 * pasted into a Track) keeps the patch's shape.
 */

export const SOURCE_NODE_FRAME =
  "w-60 rounded-md border bg-card text-card-foreground";

/** An empty slot: a dashed frame titled by its type, holding its body. */
export function EmptySourceFrame({
  title,
  embedded = false,
  removeLabel,
  selected = false,
  className,
  onRemove,
  children,
}: {
  title: string;
  embedded?: boolean;
  removeLabel: string;
  selected?: boolean;
  /** A wider body (a platform search) sets its width here. */
  className?: string;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  if (embedded) {
    return <div className="min-w-0">{children}</div>;
  }
  return (
    <div
      className={cn(
        SOURCE_NODE_FRAME,
        "border-dashed",
        selected ? "border-ring" : "border-border",
        className
      )}
    >
      <div className="flex h-8 items-center justify-between pr-1 pl-3">
        <span className="font-medium text-muted-foreground text-xs">
          {title}
        </span>
        {onRemove ? (
          <Button
            aria-label={removeLabel}
            className={cn("size-7 text-muted-foreground", INTERACTIVE)}
            onClick={onRemove}
            onKeyDown={keepControlKeys}
            size="icon"
            variant="ghost"
          >
            <XIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
      <div className={cn("px-2 pb-2", INTERACTIVE)} onKeyDown={keepControlKeys}>
        {children}
      </div>
    </div>
  );
}

export type SourceTransportProps = {
  /** What the play button and fader name, e.g. the station. */
  target: string;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  muted: boolean;
  onTogglePlayPause: () => void;
  onVolumeChange: (volume: number) => void;
  /** A fader release, where the patch takes an undo step. */
  onVolumeCommit?: () => void;
  onToggleMute: () => void;
  /** The compact channel strip under play and the fader. */
  strip?: React.ReactNode;
};

/**
 * The strip under a filled source: play or pause, its fader, and its
 * compact channel strip.
 */
export function SourceTransport({
  target,
  isPlaying,
  isLoading,
  volume,
  muted,
  onTogglePlayPause,
  onVolumeChange,
  onVolumeCommit,
  onToggleMute,
  strip,
}: SourceTransportProps) {
  const isLive = isPlaying && !isLoading;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself
    <div
      className={cn(
        "flex flex-col gap-1 border-border/50 border-t px-3 py-1.5",
        INTERACTIVE
      )}
      onKeyDown={keepControlKeys}
    >
      <div className="flex items-center gap-2">
        <PlayPauseButton
          className="size-7 shrink-0"
          iconClassName="size-3.5"
          isLoading={isLoading}
          isPlaying={isPlaying}
          label={target}
          onClick={onTogglePlayPause}
          size="sm"
          variant={isLive ? "outline" : "default"}
        />
        <VolumeControl
          className="flex-1"
          isMuted={muted || volume === 0}
          onToggleMute={onToggleMute}
          onVolumeChange={onVolumeChange}
          onVolumeCommit={onVolumeCommit}
          target={target}
          volume={volume}
        />
      </div>
      {strip}
    </div>
  );
}

/**
 * A source node's lane as the canvas reads it (runtime state by channel)
 * and the transport handlers every source gives its strip.
 */
export function useSourceLane(nodeId: string) {
  const playback = getNodePlayback();
  const runtime = usePlaybackChannelRuntimeView(laneChannelId(nodeId));
  const isPlaying = runtime?.isPlaying ?? false;
  return {
    error: runtime?.error?.message ?? null,
    isLoading: runtime?.isLoading ?? false,
    isPlaying,
    onToggleMute: () => {
      playback.toggleMute(nodeId);
      snapshotNodeGraph();
    },
    onTogglePlayPause: () => {
      playback.setPlaying(nodeId, !isPlaying);
    },
    onVolumeChange: (volume: number) => playback.setVolume(nodeId, volume),
    onVolumeCommit: () => snapshotNodeGraph(),
    playback,
  };
}
