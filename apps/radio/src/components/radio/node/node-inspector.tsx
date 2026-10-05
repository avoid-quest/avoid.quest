/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@avoid.quest/ui/components/drawer";
import { Switch } from "@avoid.quest/ui/components/switch";
import { cn } from "@avoid.quest/ui/lib/utils";
import { useStore } from "@tanstack/react-store";
import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { EffectParams } from "@/components/audio/effect-params/effect-params";
import { EffectVisualization } from "@/components/audio/visualizations/effect-visualization";
import type { EffectConfig, Radio } from "@/lib/audio";
import { getCurrentTrackIndex } from "@/lib/external-url/metadata-helpers";
import { nodeMidiTargetPrefix } from "@/lib/midi/node-midi-actions";
import { isSplitNode } from "@/lib/node-graph/branches";
import {
  getNodeDefinition,
  isEffectNodeType,
} from "@/lib/node-graph/catalogue";
import { nodeLabel } from "@/lib/node-graph/describe";
import {
  type NativeParams,
  setEffectParams,
  setNativeParams,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  type NodeStore,
  type NodeStoreState,
  nodeStore,
  setNodeSelection,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import {
  type GraphNode,
  isRadioSourceNode,
  isStripSource,
  type StripSourceNode,
} from "@/lib/node-graph/schema";
import { isLocalFileGone } from "@/lib/node-graph/sources";
import { getNodePlayback } from "@/lib/node-playback";
import type { PlatformTrack } from "@/lib/platform-types";
import {
  calculateHasTracklist,
  isStreamingMetadata,
} from "../dj/deck/deck-panel-helpers";
import { TracklistView } from "../dj/deck/deck-tracklist";
import { AudioInputNodeContent } from "./audio-input-content";
import { BackendBadge } from "./backend-badge";
import { FileNodeContent } from "./file-content";
import { feedsOutput, takenDevices } from "./flow-elements";
import { useReleaseStep } from "./module-frame";
import { NativeControls } from "./native-strip-nodes";
import { nodeIcon } from "./node-icons";
import { NodeMasterControls } from "./node-master";
import { NodeSourceStripPanel } from "./node-source-strip";
import { OutputDeviceNodeContent } from "./output-device-content";
import { SplitInspectorParams } from "./split-nodes";
import { StationNodeContent } from "./station-content";
import { TrackNodeContent } from "./track-content";

/**
 * Node Inspector
 *
 * Every param of one FX or native strip node: the full EffectParams layout
 * (with its curve) where a node body shows only the first row. A split
 * shows its mix, its bands and each branch cable's controls. A source
 * (Station, Track, File or Audio input) shows its channel strip, and a
 * Track or File holding an album or playlist its tracklist below, DJ's,
 * where a pick plays that track on its lane. It follows
 * the canvas selection in the desktop side panel and opens as a bottom
 * Drawer on a phone. Knobs are throttled like every param knob, and a
 * release is an undo step. Each knob learns MIDI as `node:<nodeId>:…`.
 */

type NativeNode = Parameters<typeof NativeControls>[0]["node"];

/** The tracks of a Track or File holding an album or playlist, if any. */
export function sourceTracklist(
  node: GraphNode | undefined
): { tracks: PlatformTrack[]; currentTrackIndex: number } | null {
  const radio = isRadioSourceNode(node)
    ? (node.data.radio as Radio | null)
    : null;
  const metadata = radio?.platformMetadata;
  // A folder picked on an earlier page has no playable tracks until repicked.
  if (
    !(
      radio &&
      !isLocalFileGone(radio) &&
      metadata &&
      calculateHasTracklist(metadata) &&
      isStreamingMetadata(metadata)
    )
  ) {
    return null;
  }
  return {
    currentTrackIndex: getCurrentTrackIndex(metadata, radio.streamUrl),
    tracks: (metadata.tracks ?? []) as PlatformTrack[],
  };
}

/**
 * FX and native strip nodes have params to inspect, and every source its
 * channel strip. Outputs expose their device or master controls; a Merge has no settings.
 */
export function isInspectable(node: GraphNode | undefined): boolean {
  return Boolean(
    node &&
      (isEffectNodeType(node.type) ||
        node.type === "filter" ||
        node.type === "pan" ||
        node.type === "gain" ||
        isStripSource(node) ||
        node.type === "deviceOut" ||
        node.type === "speakers")
  );
}

/** What the inspector is titled: a source by what it holds. */
function inspectorTitle(node: GraphNode): string {
  return isStripSource(node)
    ? nodeLabel(node)
    : getNodeDefinition(node.type).name;
}

function findNode(
  state: NodeStoreState,
  nodeId: string | null
): GraphNode | undefined {
  return nodeId === null
    ? undefined
    : state.graph?.nodes.find((node) => node.id === nodeId);
}

/** The one selected node, when it is inspectable. */
export function selectedInspectable(state: NodeStoreState): string | null {
  const [only, ...rest] = state.selection.nodes;
  if (!only || rest.length > 0) {
    return null;
  }
  return isInspectable(findNode(state, only)) ? only : null;
}

/**
 * Which node the inspector shows, and how to open or close it. On desktop
 * it is the canvas selection, so opening one selects it. A phone keeps its
 * own: the Drawer opens only when asked (a Rack chip, a node's menu), not
 * on every tap that selects a node while patching. A closed Drawer keeps
 * its node, so its content stays put while it slides away.
 */
export function useNodeInspector({
  isPhone,
  store = nodeStore,
  onInspect,
}: {
  isPhone: boolean;
  store?: NodeStore;
  /** Reveals the desktop panel before its content takes focus. */
  onInspect?: () => void;
}) {
  const [phone, setPhone] = useState<{ id: string | null; open: boolean }>({
    id: null,
    open: false,
  });
  const selected = useStore(store, selectedInspectable);
  // A node deleted while open closes its Drawer.
  const phoneExists = useStore(store, (state) =>
    isInspectable(findNode(state, phone.id))
  );
  const phoneNodeId = phoneExists ? phone.id : null;
  return {
    close: () => {
      if (isPhone) {
        setPhone((current) => ({ ...current, open: false }));
      } else {
        setNodeSelection({ edges: [], nodes: [] }, store);
      }
    },
    inspect: (id: string) => {
      if (!isPhone) {
        onInspect?.();
      }
      setNodeSelection({ edges: [], nodes: [id] }, store);
      if (isPhone) {
        setPhone({ id, open: true });
      }
    },
    nodeId: isPhone ? phoneNodeId : selected,
    open: isPhone ? phone.open && phoneNodeId !== null : selected !== null,
  };
}

/**
 * EffectParams captions and group titles are the DJ rack's mono caps; node
 * chrome is sans (§12 q7 option c), so here they read as sans labels.
 */
const INSPECTOR_BODY =
  "space-y-4 [&_.uppercase]:font-sans [&_.uppercase]:text-[10px] [&_.uppercase]:normal-case [&_.uppercase]:tracking-normal";

/** Loaded sources show their settings; empty sources keep their picker. */
function SourceInspectorParams({
  node,
  store,
}: {
  node: StripSourceNode;
  store: NodeStore;
}) {
  const graph = useStore(store, (state) => state.graph);
  let content: React.ReactNode;
  if (node.type === "deviceIn") {
    content = (
      <AudioInputNodeContent
        data={{
          ...node.data,
          feedsOutput: Boolean(graph && feedsOutput(graph, node.id)),
        }}
        id={node.id}
        showStrip={false}
        store={store}
      />
    );
  } else if (node.type === "station") {
    content = (
      <StationNodeContent data={node.data} id={node.id} showStrip={false} />
    );
  } else if (node.type === "platform") {
    content = (
      <TrackNodeContent
        data={node.data}
        id={node.id}
        showStrip={false}
        store={store}
      />
    );
  } else {
    content = (
      <FileNodeContent data={node.data} id={node.id} showStrip={false} />
    );
  }
  const hasSource =
    node.type === "deviceIn" ||
    (node.data.radio !== null && !isLocalFileGone(node.data.radio));
  const tracklist = sourceTracklist(node);
  return (
    <>
      {node.type === "deviceIn" || !hasSource ? content : null}
      {hasSource ? (
        <NodeSourceStripPanel
          node={node}
          showInputControls={false}
          store={store}
          target={inspectorTitle(node)}
        />
      ) : null}
      {tracklist ? (
        <TracklistView
          currentTrackIndex={tracklist.currentTrackIndex}
          onPlayTrack={(url) => getNodePlayback().playTrack(node.id, url)}
          tracks={tracklist.tracks}
        />
      ) : null}
    </>
  );
}

function InspectorParams({
  node,
  store,
}: {
  node: GraphNode;
  store: NodeStore;
}) {
  const title = getNodeDefinition(node.type).name;
  const currentGraph = useStore(store, (state) => state.graph);
  // A release lands after the knob throttle's trailing call, then takes
  // the turn as one undo step. Selects and switches release here too.
  const release = useReleaseStep(() => snapshotNodeGraph(store));
  let params: React.ReactNode;
  if (isStripSource(node)) {
    params = <SourceInspectorParams node={node} store={store} />;
  } else if (node.type === "deviceOut") {
    params = (
      <OutputDeviceNodeContent
        data={{
          ...node.data,
          taken: currentGraph ? takenDevices(currentGraph, node.id) : [],
        }}
        id={node.id}
        store={store}
      />
    );
  } else if (node.type === "speakers") {
    params = <NodeMasterControls />;
  } else if (isSplitNode(node)) {
    // Branches are cables here, so the rack's nested chains don't apply.
    params = <SplitInspectorParams node={node} store={store} />;
  } else if (isEffectNodeType(node.type)) {
    const { effect } = node.data as { effect: EffectConfig };
    params = (
      <>
        <EffectVisualization effect={effect} />
        <EffectParams
          effect={effect}
          midiTargetPrefix={nodeMidiTargetPrefix(node.id)}
          onUpdate={(patch) => {
            commitNodeGraph(
              (graph) => setEffectParams(graph, node.id, patch),
              store
            );
          }}
        />
      </>
    );
  } else {
    params = (
      <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
        <NativeControls
          node={node as NativeNode}
          onChange={(patch: NativeParams) => {
            commitNodeGraph(
              (graph) => setNativeParams(graph, node.id, patch),
              store
            );
          }}
          onStep={(patch: NativeParams) => {
            commitNodeGraph(
              (graph) => setNativeParams(graph, node.id, patch),
              store,
              "snapshot"
            );
          }}
          title={title}
        />
      </div>
    );
  }
  return (
    <div className={INSPECTOR_BODY} data-vaul-no-drag {...release}>
      {params}
    </div>
  );
}

/** Icon tile, title, backend badge and the effect's enable switch. */
function InspectorTitle({
  node,
  store,
  headingId,
}: {
  node: GraphNode;
  store: NodeStore;
  headingId?: string;
}) {
  const Icon = nodeIcon(node.type);
  const title = inspectorTitle(node);
  const effect = isEffectNodeType(node.type)
    ? (node.data as { effect: EffectConfig }).effect
    : null;
  const on = effect?.enabled ?? false;
  return (
    <>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-sm",
          on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
      </span>
      <h2
        className={cn(
          "min-w-0 flex-1 truncate font-medium text-xs",
          effect?.enabled === false && "text-muted-foreground"
        )}
        id={headingId}
        title={title}
      >
        {title}
      </h2>
      {effect ? <BackendBadge nodeId={node.id} /> : null}
      {effect ? (
        <Switch
          aria-label={`${title} on`}
          checked={effect.enabled}
          onCheckedChange={(enabled) => {
            commitNodeGraph(
              (graph) => setEffectParams(graph, node.id, { enabled }),
              store,
              "snapshot"
            );
          }}
        />
      ) : null}
    </>
  );
}

export type NodeInspectorProps = {
  /** null while closed. */
  nodeId: string | null;
  /**
   * Whether the phone Drawer is open; it keeps `nodeId` while it closes.
   * Open whenever `nodeId` is inspectable if unset.
   */
  open?: boolean;
  onClose: () => void;
  /** Phones get a bottom Drawer; desktop an inline panel. */
  isPhone?: boolean;
  store?: NodeStore;
};

/** The inspector for `nodeId`: inline on desktop, a Drawer on a phone. */
export function NodeInspector({
  nodeId,
  open = true,
  onClose,
  isPhone = false,
  store = nodeStore,
}: NodeInspectorProps) {
  const node = useStore(store, (state) => findNode(state, nodeId));
  const inspected = isInspectable(node) ? node : undefined;

  if (isPhone) {
    const title = inspected ? inspectorTitle(inspected) : "";
    return (
      <Drawer
        handleOnly
        onOpenChange={(next) => {
          if (!next) {
            onClose();
          }
        }}
        open={open && inspected !== undefined}
      >
        <DrawerContent>
          <DrawerHeader className="sr-only">
            <DrawerTitle>{title} settings</DrawerTitle>
            <DrawerDescription>Every setting of this node.</DrawerDescription>
          </DrawerHeader>
          {inspected ? (
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-6">
              <div className="flex h-8 items-center gap-1.5">
                <InspectorTitle node={inspected} store={store} />
              </div>
              <InspectorParams node={inspected} store={store} />
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>
    );
  }

  return inspected ? (
    <InspectorPanel node={inspected} onClose={onClose} store={store} />
  ) : null;
}

/** The chip in the Rack that opens `nodeId`, if the Rack shows one. */
function findRackChip(nodeId: string): HTMLElement | undefined {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-inspect-node]"),
  ].find((chip) => chip.dataset.inspectNode === nodeId);
}

/**
 * The desktop panel. It takes the Rack's place, so the Rack chip that
 * opened it is gone: focus moves into the panel, and closing hands it back
 * to that chip. A canvas selection keeps focus on the canvas.
 */
function InspectorPanel({
  node,
  onClose,
  store,
}: {
  node: GraphNode;
  onClose: () => void;
  store: NodeStore;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const headingId = `node-inspector-${node.id}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus follows the inspected node
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) {
      panelRef.current?.focus();
    }
  }, [node.id]);
  const close = () => {
    const hadFocus = panelRef.current?.contains(document.activeElement);
    flushSync(onClose);
    if (hadFocus) {
      findRackChip(node.id)?.focus();
    }
  };
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 outline-none"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="flex h-8 items-center gap-1.5 px-2.5">
        <InspectorTitle headingId={headingId} node={node} store={store} />
        <Button
          aria-label="Close settings"
          className="size-6 text-muted-foreground"
          onClick={close}
          size="icon"
          title="Back to the Rack"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>
      <div className="px-2.5">
        <InspectorParams node={node} store={store} />
      </div>
    </section>
  );
}
