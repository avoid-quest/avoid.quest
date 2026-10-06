/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import { cn } from "@avoid.quest/ui/lib/utils";
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  PLATFORM_SOURCE_DEFINITIONS,
  SPOTIFY_SOURCE_STYLE,
} from "@/lib/dj-library-sources";
import { setTrackSearchPlatform } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
} from "@/lib/node-graph/node-store";
import { trackChip } from "@/lib/node-graph/palette";
import {
  type GraphNode,
  TRACK_SEARCH_PLATFORMS,
  type TrackSearchPlatform,
} from "@/lib/node-graph/schema";
import { trackSubtitle } from "@/lib/node-graph/sources";
import { prepareSourceRadio } from "@/lib/node-source-loaders";
import { ExternalSearch } from "../dj/external-search";
import { InlineError } from "../inline-error";
import { platformSourceIcon } from "../platform-source-icon";
import { StationRowSubtitle, StationRowText } from "../station-row";
import { INTERACTIVE, keepControlKeys } from "./module-frame";
import { useNodeActions } from "./node-actions";
import { NodeCompactStrip } from "./node-source-strip";
import {
  EmptySourceFrame,
  SOURCE_NODE_FRAME,
  SourceTransport,
  type SourceTransportProps,
  useSourceLane,
} from "./source-node-frame";
import { beginSourceRequest } from "./use-node-radio-management";

/**
 * Track Node
 *
 * A YouTube, SoundCloud, Bandcamp or Spotify track, album or playlist, or a
 * Mixcloud show, as a source.
 * Empty, its body is DJ's external search, unlocked ("Search all") or
 * locked by a platform chip; a pick or a pasted link loads through DJ's
 * track loader. A radio link hands off: the node becomes a Station. Filled,
 * it is a card like a Station's, with the album's place in its subtitle.
 */

type TrackData = Extract<GraphNode, { type: "platform" }>["data"];

/** "Search all": DJ's colour for searching every platform. */
const [SEARCH_ALL] = PLATFORM_SOURCE_DEFINITIONS;

/** The DJ colour and icon for what a Track or File plays. */
export function sourceChipOf(radio: Radio): {
  color: string;
  Icon: ReturnType<typeof platformSourceIcon>;
} {
  const platform = radio.platformMetadata?.platform;
  // Spotify has no library tile; its Tracks wear Spotify's colour.
  const definition =
    (platform === "spotify" ? SPOTIFY_SOURCE_STYLE : undefined) ??
    PLATFORM_SOURCE_DEFINITIONS.find(
      (entry) => entry.pendingPlatform === platform
    ) ??
    PLATFORM_SOURCE_DEFINITIONS.find(
      (entry) => entry.pendingPlatform === "static-audio"
    );
  return {
    color: definition?.color ?? SEARCH_ALL.color,
    Icon: platformSourceIcon(definition?.icon ?? "static-audio"),
  };
}

/** The chips over an empty Track's search: All, then DJ's platforms. */
export function PlatformChips({
  value,
  onChange,
}: {
  value: TrackSearchPlatform | undefined;
  onChange: (platform: TrackSearchPlatform | undefined) => void;
}) {
  const chips = [
    { color: SEARCH_ALL.color, id: undefined, name: "All" },
    ...TRACK_SEARCH_PLATFORMS.map((platform) => ({
      color: trackChip(platform).color,
      id: platform,
      name: trackChip(platform).name,
    })),
  ];
  return (
    <fieldset className="flex flex-wrap gap-0.5">
      <legend className="sr-only">Search on</legend>
      {chips.map((chip) => {
        const pressed = chip.id === value;
        return (
          <Button
            aria-pressed={pressed}
            className={cn(
              "h-6 gap-1.5 px-1.5 text-xs",
              !pressed && "text-muted-foreground"
            )}
            key={chip.name}
            onClick={() => onChange(chip.id)}
            size="sm"
            variant={pressed ? "secondary" : "ghost"}
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: chip.color }}
            />
            {chip.name}
          </Button>
        );
      })}
    </fieldset>
  );
}

/** A filled Track or File: its tile, name and subtitle, menu, error, strip. */
export function TrackCard({
  radio,
  typeName,
  selected = false,
  error,
  onRemove,
  ...transport
}: Omit<SourceTransportProps, "target"> & {
  radio: Radio;
  /** "Track" or "File", for its menu. */
  typeName: string;
  selected?: boolean;
  error: string | null;
  onRemove?: () => void;
}) {
  const { color, Icon } = sourceChipOf(radio);
  const isLive = transport.isPlaying && !transport.isLoading;
  return (
    <div
      className={cn(
        SOURCE_NODE_FRAME,
        "border-border/50",
        isLive && "border-foreground/40",
        selected && "border-ring"
      )}
      data-radio-id={String(radio.id ?? radio.name)}
    >
      <div className="flex items-center gap-2 py-2.5 pr-1.5 pl-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-border/70"
          style={{ backgroundColor: `${color}1a` }}
        >
          <Icon aria-hidden="true" className="size-5" style={{ color }} />
        </span>
        <StationRowText title={radio.name}>
          <StationRowSubtitle>{trackSubtitle(radio)}</StationRowSubtitle>
        </StationRowText>
        {onRemove ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself
          <div
            className={cn("self-start", INTERACTIVE)}
            onKeyDown={keepControlKeys}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Options for ${radio.name}`}
                  className="size-7 text-muted-foreground"
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onRemove} variant="destructive">
                  <Trash2Icon />
                  Remove {typeName}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      {error?.trim() ? (
        <InlineError className="mx-3 mb-2">{error}</InlineError>
      ) : null}
      <SourceTransport target={radio.name} {...transport} />
    </div>
  );
}

type TrackNodeBodyProps = Omit<SourceTransportProps, "target"> & {
  data: TrackData;
  error: string | null;
  selected?: boolean;
  /** A search pick or pasted link, resolved by DJ's track loader. */
  onLoad: (radio: Radio) => void;
  /** A pasted radio stream link, which makes the Track a Station. */
  onStreamLink?: (url: string) => void;
  onSearchPlatformChange: (platform: TrackSearchPlatform | undefined) => void;
  onRemove?: () => void;
};

export function TrackNodeBody({
  data,
  error,
  selected = false,
  onLoad,
  onStreamLink,
  onSearchPlatformChange,
  onRemove,
  ...transport
}: TrackNodeBodyProps) {
  const radio = data.radio as Radio | null;
  if (radio) {
    return (
      <TrackCard
        error={error}
        onRemove={onRemove}
        radio={radio}
        selected={selected}
        typeName="Track"
        {...transport}
      />
    );
  }
  return (
    <EmptySourceFrame
      className="w-84"
      onRemove={onRemove}
      removeLabel="Remove empty Track"
      selected={selected}
      title="Track"
    >
      <div className="flex flex-col gap-1">
        <PlatformChips
          onChange={onSearchPlatformChange}
          value={data.searchPlatform}
        />
        <div className="flex max-h-80 flex-col">
          {/* The chips above pick the platform, so its own select stays off. */}
          <ExternalSearch
            initialPlatform={data.searchPlatform ?? "all"}
            mode="node"
            onLoad={onLoad}
            onOtherLink={onStreamLink}
            showPlatform={false}
          />
        </div>
        {error?.trim() ? <InlineError>{error}</InlineError> : null}
      </div>
    </EmptySourceFrame>
  );
}

/** The Track's controls, shared by the patch and inspector. */
export function TrackNodeContent({
  id,
  data,
  selected,
  showStrip = true,
  store = nodeStore,
}: {
  id: string;
  data: TrackData;
  selected?: boolean;
  showStrip?: boolean;
  store?: NodeStore;
}) {
  const actions = useNodeActions();
  const lane = useSourceLane(id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const radio = data.radio as Radio | null;
  // The search stays open while a `yt:` pick resolves; a later pick, link
  // or platform, here or in the other view of this Track, supersedes it,
  // so only the latest request fills the Track or reports its error.
  const reportLoadFailure = (isCurrent: () => boolean) => (cause: unknown) => {
    if (isCurrent()) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleLoad = async (picked: Radio, isCurrent: () => boolean) => {
    setLoadError(null);
    const loaded = await prepareSourceRadio(picked);
    if (!isCurrent()) {
      return;
    }
    if ("error" in loaded) {
      setLoadError(loaded.error);
      return;
    }
    await actions.fillSource(id, loaded.radio, isCurrent);
  };
  // A radio stream hands off: the Track becomes a Station playing it.
  const handleStreamLink = async (url: string, isCurrent: () => boolean) => {
    setLoadError(null);
    const failure = await actions.fillStationFromUrl(id, url, isCurrent);
    if (isCurrent()) {
      setLoadError(failure);
    }
  };

  return (
    <TrackNodeBody
      data={data}
      error={radio ? lane.error : loadError}
      isLoading={lane.isLoading}
      isPlaying={lane.isPlaying}
      muted={data.muted}
      onLoad={(picked) => {
        const isCurrent = beginSourceRequest(id);
        handleLoad(picked, isCurrent).catch(reportLoadFailure(isCurrent));
      }}
      onRemove={() => actions.removeNode(id)}
      onSearchPlatformChange={(platform) => {
        beginSourceRequest(id);
        commitNodeGraph(
          (graph) => setTrackSearchPlatform(graph, id, platform),
          store,
          "snapshot"
        );
      }}
      onStreamLink={(url) => {
        const isCurrent = beginSourceRequest(id);
        handleStreamLink(url, isCurrent).catch(reportLoadFailure(isCurrent));
      }}
      onToggleMute={lane.onToggleMute}
      onTogglePlayPause={lane.onTogglePlayPause}
      onVolumeChange={lane.onVolumeChange}
      onVolumeCommit={lane.onVolumeCommit}
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
