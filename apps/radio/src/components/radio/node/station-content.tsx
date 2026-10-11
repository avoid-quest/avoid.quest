/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { cn } from "@avoid.quest/ui/lib/utils";
import type { Radio } from "@/lib/audio";
import { useHasEnteredViewport } from "@/lib/hooks/use-has-entered-viewport";
import { useRadioMetadata } from "@/lib/hooks/use-radio-metadata";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import type { GraphNode } from "@/lib/node-graph/schema";
import { InlineError } from "../inline-error";
import { RadioItemActions } from "../radio-item-actions";
import { RadioNowPlaying } from "../radio-now-playing";
import { RadioSearchBar } from "../radio-search-bar";
import { INTERACTIVE, keepControlKeys } from "./module-frame";
import { useNodeActions } from "./node-actions";
import { NodeCompactStrip } from "./node-source-strip";
import {
  EmptySourceFrame,
  SOURCE_NODE_FRAME,
  SourceTransport,
  useSourceLane,
} from "./source-node-frame";
import { beginSourceRequest } from "./use-node-radio-management";

type StationData = Extract<GraphNode, { type: "station" }>["data"];

type StationNodeBodyProps = {
  embedded?: boolean;
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
  /** A pasted stream link; resolves to why it failed, or null. */
  onSubmitUrl?: (url: string, signal: AbortSignal) => Promise<string | null>;
  onRemove?: () => void;
  onEdit?: (radio: Radio) => void;
  onDelete?: (radio: Radio) => void;
  onToggle?: (radio: Radio, enabled: boolean) => void;
  onSave?: (radio: Radio) => void;
  /** The compact channel strip under play and the fader. */
  strip?: React.ReactNode;
};

/**
 * An empty Station slot: its body is the station search, where a pasted
 * radio stream link is played as a session station.
 */
function EmptyStation({
  embedded,
  radios,
  selected,
  onSelectLocal,
  onSelectDiscovered,
  onSaveDiscovered,
  onSubmitUrl,
  onRemove,
}: Pick<
  StationNodeBodyProps,
  | "embedded"
  | "radios"
  | "selected"
  | "onSelectLocal"
  | "onSelectDiscovered"
  | "onSaveDiscovered"
  | "onSubmitUrl"
  | "onRemove"
>) {
  return (
    <EmptySourceFrame
      embedded={embedded}
      onRemove={onRemove}
      removeLabel="Remove empty Station"
      selected={selected}
      title="Station"
    >
      <RadioSearchBar
        // Wider than the slot, so similar names read apart.
        dropdownClassName="right-auto w-80"
        onSaveDiscovered={onSaveDiscovered}
        onSelectDiscovered={onSelectDiscovered}
        onSelectLocal={onSelectLocal}
        onSubmitUrl={onSubmitUrl}
        placeholder="Search or paste a stream"
        radios={radios}
      />
    </EmptySourceFrame>
  );
}

/**
 * A Station's card: now playing, its menu, any play error, play and volume.
 * Metadata polls only while the Station plays; a stopped one fetches once
 * when it first scrolls into view. A hidden saved station greys out and
 * keeps only its menu, where Show brings it back.
 */
export function StationNodeBody({
  embedded,
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
  onSubmitUrl,
  onRemove,
  onEdit,
  onDelete,
  onToggle,
  onSave,
  strip,
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
        embedded={embedded}
        onRemove={onRemove}
        onSaveDiscovered={onSaveDiscovered}
        onSelectDiscovered={onSelectDiscovered}
        onSelectLocal={onSelectLocal}
        onSubmitUrl={onSubmitUrl}
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
        SOURCE_NODE_FRAME,
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
        <SourceTransport
          isLoading={isLoading}
          isPlaying={isPlaying}
          muted={muted}
          onToggleMute={onToggleMute}
          onTogglePlayPause={onTogglePlayPause}
          onVolumeChange={onVolumeChange}
          onVolumeCommit={onVolumeCommit}
          strip={strip}
          target={radio.name}
          volume={volume}
        />
      )}
    </div>
  );
}

/** The Station's controls, shared by the patch and inspector. */
export function StationNodeContent({
  id,
  data,
  selected,
  showStrip = true,
}: {
  id: string;
  data: StationData;
  selected?: boolean;
  showStrip?: boolean;
}) {
  const actions = useNodeActions();
  const lane = useSourceLane(id);
  const radio = data.radio as Radio | null;

  return (
    <StationNodeBody
      embedded={!showStrip}
      error={lane.error}
      isLoading={lane.isLoading}
      isPlaying={lane.isPlaying}
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
      onSubmitUrl={(url, signal) =>
        actions.fillStationFromUrl(id, url, beginSourceRequest(id, signal))
      }
      onToggle={actions.handleToggleRadio}
      onToggleMute={lane.onToggleMute}
      onTogglePlayPause={lane.onTogglePlayPause}
      onVolumeChange={lane.onVolumeChange}
      onVolumeCommit={lane.onVolumeCommit}
      radio={radio}
      radios={actions.radios}
      selected={selected}
      strip={
        radio && showStrip ? (
          <NodeCompactStrip
            muted={data.muted}
            nodeId={id}
            onInspect={() => actions.inspectNode(id)}
            strip={data.strip}
            target={radio.name}
          />
        ) : null
      }
      volume={data.volume}
    />
  );
}
