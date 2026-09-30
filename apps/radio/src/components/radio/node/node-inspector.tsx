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
import { useState } from "react";
import { EffectParams } from "@/components/audio/effect-params/effect-params";
import { EffectVisualization } from "@/components/audio/visualizations/effect-visualization";
import type { EffectConfig } from "@/lib/audio";
import { nodeMidiTargetPrefix } from "@/lib/midi/node-midi-actions";
import {
  getNodeDefinition,
  isEffectNodeType,
} from "@/lib/node-graph/catalogue";
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
import type { GraphNode } from "@/lib/node-graph/schema";
import { BackendBadge } from "./backend-badge";
import { RELEASE_DELAY_MS } from "./module-frame";
import { NativeControls } from "./native-strip-nodes";
import { nodeIcon } from "./node-icons";

/**
 * Node Inspector
 *
 * Every param of one FX or native strip node: the full EffectParams layout
 * (with its curve) where a node body shows only the first row. It follows
 * the canvas selection in the desktop side panel and opens as a bottom
 * Drawer on a phone. Knobs are throttled like every param knob, and a
 * release is an undo step. Each knob learns MIDI as `node:<nodeId>:…`.
 */

type NativeNode = Parameters<typeof NativeControls>[0]["node"];

/** FX and native strip nodes have params to inspect; Stations don't. */
export function isInspectable(node: GraphNode | undefined): boolean {
  return Boolean(
    node &&
      (isEffectNodeType(node.type) ||
        node.type === "filter" ||
        node.type === "pan" ||
        node.type === "gain")
  );
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
 * on every tap that selects a node while patching.
 */
export function useNodeInspector({
  isPhone,
  store = nodeStore,
}: {
  isPhone: boolean;
  store?: NodeStore;
}) {
  const [phoneNodeId, setPhoneNodeId] = useState<string | null>(null);
  const selected = useStore(store, selectedInspectable);
  // A node deleted while open closes its Drawer.
  const phoneOpen = useStore(store, (state) =>
    isInspectable(findNode(state, phoneNodeId))
  );
  const phoneShown = phoneOpen ? phoneNodeId : null;
  const nodeId = isPhone ? phoneShown : selected;
  return {
    close: () => {
      if (isPhone) {
        setPhoneNodeId(null);
      } else {
        setNodeSelection({ edges: [], nodes: [] }, store);
      }
    },
    inspect: (id: string) => {
      setNodeSelection({ edges: [], nodes: [id] }, store);
      if (isPhone) {
        setPhoneNodeId(id);
      }
    },
    nodeId,
  };
}

/**
 * EffectParams captions and group titles are the DJ rack's mono caps; node
 * chrome is sans (§12 q7 option c), so here they read as sans labels.
 */
const INSPECTOR_BODY =
  "space-y-4 [&_.uppercase]:font-sans [&_.uppercase]:text-[10px] [&_.uppercase]:normal-case [&_.uppercase]:tracking-normal";

function InspectorParams({
  node,
  store,
}: {
  node: GraphNode;
  store: NodeStore;
}) {
  const title = getNodeDefinition(node.type).name;
  // A release lands after the knob throttle's trailing call, then takes
  // the turn as one undo step. Selects and switches release here too.
  const release = () => {
    setTimeout(() => snapshotNodeGraph(store), RELEASE_DELAY_MS);
  };
  let params: React.ReactNode;
  if (isEffectNodeType(node.type)) {
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
    // biome-ignore lint/a11y/noStaticElementInteractions: listens for releases; each control is focusable itself
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: listens for releases; each control is focusable itself
    <div
      className={INSPECTOR_BODY}
      data-vaul-no-drag
      onKeyUp={release}
      onPointerUp={release}
    >
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
  const title = getNodeDefinition(node.type).name;
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
  onClose: () => void;
  /** Phones get a bottom Drawer; desktop an inline panel. */
  isPhone?: boolean;
  store?: NodeStore;
};

/** The inspector for `nodeId`: inline on desktop, a Drawer on a phone. */
export function NodeInspector({
  nodeId,
  onClose,
  isPhone = false,
  store = nodeStore,
}: NodeInspectorProps) {
  const node = useStore(store, (state) => findNode(state, nodeId));
  const inspected = isInspectable(node) ? node : undefined;

  if (isPhone) {
    const title = inspected ? getNodeDefinition(inspected.type).name : "";
    return (
      <Drawer
        handleOnly
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        open={inspected !== undefined}
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

  if (!inspected) {
    return null;
  }
  const headingId = `node-inspector-${inspected.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex h-8 items-center gap-1.5 px-2.5">
        <InspectorTitle headingId={headingId} node={inspected} store={store} />
        <Button
          aria-label="Close settings"
          className="size-6 text-muted-foreground"
          onClick={onClose}
          size="icon"
          title="Back to the Rack"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>
      <div className="px-2.5">
        <InspectorParams node={inspected} store={store} />
      </div>
    </section>
  );
}
