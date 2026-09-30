/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useStore } from "@tanstack/react-store";
import { XIcon } from "lucide-react";
import { VolumeControl } from "@/components/audio/volume-control";
import type { Radio } from "@/lib/audio";
import { useHasEnteredViewport } from "@/lib/hooks/use-has-entered-viewport";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { findPort } from "@/lib/node-graph/catalogue";
import { laneChannelId } from "@/lib/node-graph/compile";
import { snapshotNodeGraph } from "@/lib/node-graph/node-store";
import type { GraphNode } from "@/lib/node-graph/schema";
import { getNodePlayback } from "@/lib/node-playback";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { InlineError } from "../inline-error";
import { RadioItemActions } from "../radio-item-actions";
import { RadioNowPlaying } from "../radio-now-playing";
import { RadioSearchBar } from "../radio-search-bar";
import { type FlowNode, type FlowNodeProps, Position } from "./flow-adapter";
import { keepControlKeys, NodePort } from "./module-frame";
import { useNodeActions } from "./node-actions";

type StationData = Extract<GraphNode, { type: "station" }>["data"];
export type StationFlowNode = FlowNode<StationData, "station">;

/** React Flow skips drag, pan and wheel zoom on these, so controls work. */
const INTERACTIVE = "nodrag nopan nowheel";

type StationNodeBodyProps = {
  radio: Radio | null;
  volume: number;
  muted: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  selected?: boolean;
  /** Saved stations an empty slot's search offers first. */
  radios: Radio[];
  onTogglePlayPause: () => void;
  onVolumeChange: (volume: number) => void;
  /** A fader release, where the patch takes an undo step. */
  onVolumeCommit?: () => void;
  onToggleMute: () => void;
  onSelectLocal: (radio: Radio) => void;
  onSelectDiscovered: (radio: Radio) => void;
  onSaveDiscovered?: (radio: Radio) => void;
  onRemove?: () => void;
  onEdit?: (radio: Radio) => void;
  onDelete?: (radio: Radio) => void;
  onToggle?: (radio: Radio, enabled: boolean) => void;
  onSave?: (radio: Radio) => void;
};

const AUDIO_OUT = findPort("station", "out", "audio", "main");

const NODE_FRAME = "w-60 rounded-md border bg-card text-card-foreground";

/** An empty Station slot: its body is the station search. */
function EmptyStation({
  radios,
  selected,
  onSelectLocal,
  onSelectDiscovered,
  onSaveDiscovered,
  onRemove,
}: Pick<
  StationNodeBodyProps,
  | "radios"
  | "selected"
  | "onSelectLocal"
  | "onSelectDiscovered"
  | "onSaveDiscovered"
  | "onRemove"
>) {
  return (
    <div
      className={cn(
        NODE_FRAME,
        "border-dashed",
        selected ? "border-ring" : "border-border"
      )}
    >
      <div className="flex h-8 items-center justify-between pr-1 pl-3">
        <span className="font-medium text-muted-foreground text-xs">
          Station
        </span>
        {onRemove ? (
          <Button
            aria-label="Remove empty Station"
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
        <RadioSearchBar
          onSaveDiscovered={onSaveDiscovered}
          onSelectDiscovered={onSelectDiscovered}
          onSelectLocal={onSelectLocal}
          placeholder="Search a station"
          radios={radios}
        />
      </div>
    </div>
  );
}

/**
 * A Station's card: now playing, its menu, any play error, play and volume.
 * Metadata polls only while the Station plays; a stopped one fetches once
 * when it first scrolls into view. A hidden saved station greys out and
 * keeps only its menu, where Show brings it back.
 */
export function StationNodeBody({
  radio,
  volume,
  muted,
  isPlaying,
  isLoading,
  error,
  selected = false,
  radios,
  onTogglePlayPause,
  onVolumeChange,
  onVolumeCommit,
  onToggleMute,
  onSelectLocal,
  onSelectDiscovered,
  onSaveDiscovered,
  onRemove,
  onEdit,
  onDelete,
  onToggle,
  onSave,
}: StationNodeBodyProps) {
  const { elementRef, hasEnteredViewport } =
    useHasEnteredViewport<HTMLDivElement>();
  const disabled = radio?.enabled === false;
  const { metadata } = useRadioMetadata({
    enabled: !disabled && (isPlaying || hasEnteredViewport),
    poll: isPlaying && !isLoading,
    radio,
  });

  if (!radio) {
    return (
      <EmptyStation
        onRemove={onRemove}
        onSaveDiscovered={onSaveDiscovered}
        onSelectDiscovered={onSelectDiscovered}
        onSelectLocal={onSelectLocal}
        radios={radios}
        selected={selected}
      />
    );
  }

  const isSession = isSessionRadio(radio);
  const isLive = isPlaying && !isLoading;

  return (
    <div
      className={cn(
        NODE_FRAME,
        "relative border-border/50",
        isLive && "border-foreground/40",
        selected && "border-ring",
        isSession && "border-l-2 border-l-[#00d084]/40",
        disabled && "opacity-60"
      )}
      data-radio-id={String(radio.id ?? radio.name)}
      ref={elementRef}
    >
      <div className="py-2.5 pr-10 pl-3">
        <RadioNowPlaying
          isLoading={isLoading}
          metadata={disabled ? null : metadata}
          radio={radio}
        />
      </div>
      {/* Menu after the header so Tab reaches the station first */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
      <div
        className={cn("absolute top-1.5 right-1.5", INTERACTIVE)}
        onKeyDown={keepControlKeys}
      >
        <RadioItemActions
          onDelete={onDelete}
          onEdit={onEdit}
          onSave={onSave}
          onToggle={onToggle}
          radio={radio}
        />
      </div>

      {error?.trim() && !disabled ? (
        <InlineError className="mx-3 mb-2">{error}</InlineError>
      ) : null}

      {disabled ? (
        <p className="border-border/50 border-t px-3 py-2 text-muted-foreground text-xs">
          Hidden. Show it to play here.
        </p>
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself
        <div
          className={cn(
            "flex items-center gap-2 border-border/50 border-t px-3 py-1.5",
            INTERACTIVE
          )}
          onKeyDown={keepControlKeys}
        >
          <PlayPauseButton
            className="size-7 shrink-0"
            iconClassName="size-3.5"
            isLoading={isLoading}
            isPlaying={isPlaying}
            label={radio.name}
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
            target={radio.name}
            volume={volume}
          />
        </div>
      )}
    </div>
  );
}

/** The Station node on the canvas: its body plus the audio out port. */
export function StationNode({
  id,
  data,
  selected,
}: FlowNodeProps<StationFlowNode>) {
  const actions = useNodeActions();
  const playback = getNodePlayback();
  const runtime = useStore(
    playbackRuntimeStore,
    (state) => state.channels[laneChannelId(id)]
  );
  const isPlaying = runtime?.isPlaying ?? false;
  const isLoading = runtime?.isLoading ?? false;
  const radio = data.radio as Radio | null;

  return (
    <>
      <StationNodeBody
        error={runtime?.error?.message ?? null}
        isLoading={isLoading}
        isPlaying={isPlaying}
        muted={data.muted}
        onDelete={actions.handleDeleteRadio}
        onEdit={actions.handleEditRadio}
        onRemove={() => actions.removeNode(id)}
        onSave={actions.handleSaveSessionRadio}
        onSaveDiscovered={actions.saveDiscoveredStation}
        onSelectDiscovered={(picked) =>
          actions.selectDiscoveredForStation(id, picked)
        }
        onSelectLocal={(picked) => {
          actions.fillStation(id, picked);
        }}
        onToggle={actions.handleToggleRadio}
        onToggleMute={() => {
          playback.toggleMute(id);
          snapshotNodeGraph();
        }}
        onTogglePlayPause={() => {
          playback.setPlaying(id, !isPlaying);
        }}
        onVolumeChange={(volume) => playback.setVolume(id, volume)}
        onVolumeCommit={() => snapshotNodeGraph()}
        radio={radio}
        radios={actions.radios}
        selected={selected}
        volume={data.volume}
      />
      {AUDIO_OUT ? (
        <NodePort
          ariaLabel={`${radio?.name ?? "Station"} audio out`}
          className={cn(isPlaying && !isLoading && "node-port-live")}
          label="Audio out"
          port={AUDIO_OUT}
          position={Position.Right}
          type="station"
        />
      ) : null}
    </>
  );
}
