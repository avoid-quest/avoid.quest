/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import type { Radio } from "@/lib/audio";
import type { GraphNode } from "@/lib/node-graph/schema";
import {
  isLocalFileGone,
  releaseUnusedLocalFileUrls,
} from "@/lib/node-graph/sources";
import {
  loadLocalFile,
  loadLocalFiles,
  loadSourceUrl,
} from "@/lib/node-source-loaders";
import { FileForm } from "../dj/file-form";
import { type NodeActions, useNodeActions } from "./node-actions";
import { NodeCompactStrip } from "./node-source-strip";
import {
  EmptySourceFrame,
  type SourceTransportProps,
  useSourceLane,
} from "./source-node-frame";
import { TrackCard } from "./track-content";
import { beginSourceRequest } from "./use-node-radio-management";

/**
 * File Node
 *
 * A local file or a static audio URL (MP3, M3U, PLS) as a source. Empty,
 * its body is DJ's file form. A local file plays from an object URL that
 * dies with the page, so after a reload the File keeps its name and asks
 * for the file again; it has no lane until then. A URL survives reloads.
 */

type FileData = Extract<GraphNode, { type: "file" }>["data"];

/** What a File's form loads: resolves to why it failed, or null. */
type LoadSource<T> = (source: T) => Promise<string | null>;

type FileNodeBodyProps = Omit<SourceTransportProps, "target"> & {
  data: FileData;
  embedded?: boolean;
  error: string | null;
  selected?: boolean;
  onLoadFile: LoadSource<File>;
  onLoadUrl: LoadSource<string>;
  onLoadFiles?: LoadSource<readonly File[]>;
  onRemove?: () => void;
};

export function FileNodeBody({
  data,
  embedded,
  error,
  selected = false,
  onLoadFile,
  onLoadUrl,
  onLoadFiles,
  onRemove,
  ...transport
}: FileNodeBodyProps) {
  const radio = data.radio as Radio | null;
  if (radio && !isLocalFileGone(radio)) {
    return (
      <TrackCard
        error={error}
        onRemove={onRemove}
        radio={radio}
        selected={selected}
        typeName="File"
        {...transport}
      />
    );
  }
  return (
    <EmptySourceFrame
      embedded={embedded}
      onRemove={onRemove}
      removeLabel={radio ? `Remove ${radio.name}` : "Remove empty File"}
      selected={selected}
      title={radio?.name ?? "File"}
    >
      {radio ? (
        <p className="px-1 pt-1 text-muted-foreground text-xs">
          Pick the file again
        </p>
      ) : null}
      <FileForm
        onLoad={onLoadFile}
        onLoadFiles={onLoadFiles}
        onLoadUrl={onLoadUrl}
      />
    </EmptySourceFrame>
  );
}

/**
 * Loads a pick or link into File `id` and returns its error, if any. The
 * request is taken as the load starts, so a newer pick or link, here or in
 * the other view of this File, supersedes it even if this one finishes
 * last. Kept out of FileNodeContent: the React Compiler cannot lower a
 * `try` without a `catch` and would skip the whole component.
 */
async function fillFile(
  id: string,
  loading: Promise<{ radio: Radio } | { error: string }>,
  actions: NodeActions
): Promise<string | null> {
  const isCurrent = beginSourceRequest(id);
  try {
    const loaded = await loading;
    if (!isCurrent()) {
      return null;
    }
    if ("error" in loaded) {
      return loaded.error;
    }
    await actions.fillSource(id, loaded.radio, isCurrent);
    return null;
  } finally {
    releaseUnusedLocalFileUrls();
  }
}

/** The File's controls, shared by the patch and inspector. */
export function FileNodeContent({
  id,
  data,
  selected,
  showStrip = true,
}: {
  id: string;
  data: FileData;
  selected?: boolean;
  showStrip?: boolean;
}) {
  const actions = useNodeActions();
  const lane = useSourceLane(id);
  const radio = data.radio as Radio | null;
  const fill = (loading: Promise<{ radio: Radio } | { error: string }>) =>
    fillFile(id, loading, actions);

  return (
    <FileNodeBody
      data={data}
      embedded={!showStrip}
      error={lane.error}
      isLoading={lane.isLoading}
      isPlaying={lane.isPlaying}
      muted={data.muted}
      onLoadFile={(file) => fill(loadLocalFile(id, file))}
      onLoadFiles={(files) => fill(loadLocalFiles(files))}
      onLoadUrl={(url) => fill(loadSourceUrl(url))}
      onRemove={() => actions.removeNode(id)}
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
