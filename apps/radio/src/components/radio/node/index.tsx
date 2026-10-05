/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type ResizablePanelHandle,
} from "@avoid.quest/ui/components/resizable";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ClientOnly } from "@/components/client-only";
import type { Radio } from "@/lib/audio";
import { useMediaSession } from "@/lib/hooks/use-media-session";
import { useNodeMidi } from "@/lib/hooks/use-node-midi";
import { useNodeSession } from "@/lib/hooks/use-node-session";
import { useAllRadios } from "@/lib/hooks/use-radios";
import { removeNodesHealed } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  nodeStore,
  useNodeGraph,
  useNodeReadOnlyVersion,
} from "@/lib/node-graph/node-store";
import { templatePatch } from "@/lib/node-graph/palette";
import type { NodeTemplateId } from "@/lib/node-graph/templates";
import { detectNodePlaybackEnv } from "@/lib/node-playback";
import { RadioDialog } from "../../settings/radio-dialog";
import { ConfirmDeleteDialog } from "../confirm-delete-dialog";
import { NodeCanvasSkeleton } from "../radio-loading-skeleton";
import { RadioSearchBar } from "../radio-search-bar";
import { NodeCanvasHint } from "./canvas-hint";
import { ConnectDialog } from "./connect-dialog";
import { type NodeActions, NodeActionsProvider } from "./node-actions";
import type { PortDrop } from "./node-canvas";
import { NodeInspector, useNodeInspector } from "./node-inspector";
import {
  NodePalette,
  type PaletteRequest,
  usePaletteShortcut,
} from "./node-palette";
import { NodeRack } from "./node-rack";
import { NodeToolbar, useUndoShortcuts } from "./node-toolbar";
import { RewireDialog } from "./rewire-dialog";
import { useNodeRadioManagement } from "./use-node-radio-management";

/**
 * React Flow stays in this lazy client chunk. The Worker build folds the
 * branch away, so no `@xyflow` code reaches the SSR bundle.
 */
const NodeCanvas = lazy(() =>
  import.meta.env.SSR
    ? Promise.resolve({ default: () => null })
    : import("./node-canvas")
);

/** Space toggles playback unless the key already activates something else. */
const SPACE_SHORTCUT_IGNORED_TARGETS =
  "input, textarea, select, button, a, summary, [role=slider], [role=menuitem], [role=option], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=combobox], [role=dialog], [role=menu], .react-flow__node, .react-flow__edge";

export function NodeRadios({ radios }: { radios?: Radio[] }) {
  const graph = useNodeGraph();
  const readOnlyVersion = useNodeReadOnlyVersion();
  const savedRadios = useAllRadios();
  const { pauseAll, playAll, playingCount, sources } = useNodeSession();
  const [reveal, setReveal] = useState<{ nodeId: string } | null>(null);
  const [palette, setPalette] = useState<PaletteRequest | null>(null);
  const [connectNodeId, setConnectNodeId] = useState<string | null>(null);
  const [rewireEdgeId, setRewireEdgeId] = useState<string | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const [portDrop, setPortDrop] = useState<PortDrop | null>(null);
  const isPhone = useIsMobile();
  const inspectorPanel = useRef<ResizablePanelHandle | null>(null);
  const inspector = useNodeInspector({
    isPhone,
    onInspect: () => inspectorPanel.current?.expand(),
  });
  useNodeMidi(graph);
  const management = useNodeRadioManagement({
    onStationAdded: (nodeId) => setReveal({ nodeId }),
    savedRadios: savedRadios.isReady ? savedRadios.data : undefined,
  });

  const validateOptions = { profile: detectNodePlaybackEnv().profile };
  // Before the patch loads there is nothing to add to, and a request kept
  // until then would pop the palette open on its own.
  const openPalette = (request: PaletteRequest = {}) => {
    if (nodeStore.state.graph) {
      setPalette(request);
    }
  };
  usePaletteShortcut(openPalette);
  useUndoShortcuts();

  /** Replaces the patch with a template, as one undo step, then fits it. */
  const loadTemplate = (template: NodeTemplateId) => {
    const saved = savedRadios.isReady ? savedRadios.data : [];
    commitNodeGraph(
      (current) =>
        templatePatch(current, template, {
          saved,
          session: management.sessionRadios,
        }),
      nodeStore,
      "snapshot"
    );
    setReveal(null);
    setFitRequest((count) => count + 1);
  };

  const isAnyPlaying = playingCount > 0;
  const hasSources = sources.length > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== " " ||
        event.repeat ||
        event.defaultPrevented ||
        !hasSources
      ) {
        return;
      }
      const { target } = event;
      if (
        target instanceof Element &&
        ((target instanceof HTMLElement && target.isContentEditable) ||
          target.closest(SPACE_SHORTCUT_IGNORED_TARGETS))
      ) {
        return;
      }
      event.preventDefault();
      if (isAnyPlaying) {
        pauseAll();
      } else {
        playAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasSources, isAnyPlaying, pauseAll, playAll]);

  useMediaSession({
    mode: "node",
    playingCount,
    radios: sources.map((source) => source.radio),
  });

  const actions: NodeActions = {
    fillSource: management.fillSource,
    fillStation: management.fillStation,
    fillStationFromUrl: management.fillStationFromUrl,
    handleDeleteRadio: management.handleDeleteRadio,
    handleEditRadio: management.handleEditRadio,
    handleSaveSessionRadio: management.handleSaveSessionRadio,
    handleToggleRadio: management.handleToggleRadio,
    inspectNode: inspector.inspect,
    radios: radios ?? [],
    removeNode: (nodeId) => {
      const current = nodeStore.state.graph;
      if (!current) {
        return;
      }
      const edit = removeNodesHealed(current, [nodeId], validateOptions);
      if (!edit.ok) {
        toast(edit.message);
        return;
      }
      commitNodeGraph(() => edit.graph, nodeStore, "snapshot");
    },
    revealNode: (nodeId) => {
      setReveal({ nodeId });
    },
    saveDiscoveredStation: management.saveDiscoveredStation,
    selectDiscoveredForStation: management.selectDiscoveredForStation,
    swapEffect: (nodeId) => openPalette({ swap: nodeId }),
  };
  const handleSelectLocal = (radio: Radio) => {
    management.addStation(radio);
  };
  const handleCancelDelete = () => management.setDeleteConfirm(null);
  // A node placed where the user pointed is in view already; one placed in
  // a free spot may not be.
  const handlePaletteAdded = (nodeId: string, request: PaletteRequest) => {
    if (request.drop && request.from) {
      setPortDrop({ from: request.from, nodeId, y: request.drop.y });
    }
    if (!request.position) {
      setReveal({ nodeId });
    }
  };

  const canvas = (
    <div className="relative h-full min-h-0">
      {graph ? (
        <ClientOnly fallback={<NodeCanvasSkeleton />}>
          <Suspense fallback={<NodeCanvasSkeleton />}>
            <NodeCanvas
              fitRequest={fitRequest}
              isPhone={isPhone}
              onFitHandled={() => setFitRequest(0)}
              onOpenConnect={setConnectNodeId}
              onOpenPalette={openPalette}
              onPortDropHandled={() => setPortDrop(null)}
              portDrop={portDrop}
              reveal={reveal}
            />
          </Suspense>
        </ClientOnly>
      ) : (
        <NodeCanvasSkeleton />
      )}
      <NodeCanvasHint graph={graph} isPhone={isPhone} />
    </div>
  );
  const rack = graph ? <NodeRack graph={graph} /> : null;

  if (readOnlyVersion !== null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md space-y-2" role="status">
          <h2 className="font-semibold">This patch is read-only</h2>
          <p className="text-muted-foreground text-sm">
            This patch uses a newer format (version {readOnlyVersion}). It is
            preserved on this device, but this app cannot edit or play it. Open
            it in the newer app, or use Single or DJ mode to keep listening.
          </p>
        </div>
      </div>
    );
  }

  return (
    <NodeActionsProvider value={actions}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <RadioSearchBar
            className="w-full min-w-0 max-w-md"
            onSaveDiscovered={management.saveDiscoveredStation}
            onSelectDiscovered={management.selectDiscoveredStation}
            onSelectLocal={handleSelectLocal}
            placeholder={
              isPhone ? "Search stations" : "Search to add a station"
            }
            radios={radios ?? []}
          />
          <NodeToolbar
            isPhone={isPhone}
            onAdd={() => openPalette()}
            onFitView={() => setFitRequest((count) => count + 1)}
            onLoadTemplate={loadTemplate}
            onRewire={setRewireEdgeId}
          />
        </div>
        {isPhone ? (
          <div className="min-h-0 flex-1">{canvas}</div>
        ) : (
          <ResizablePanelGroup className="min-h-0 flex-1 border-border/50 border-t">
            <ResizablePanel minSize="50">{canvas}</ResizablePanel>
            <ResizableHandle />
            <ResizablePanel
              collapsedSize={0}
              collapsible
              defaultSize={360}
              maxSize="40"
              minSize={240}
              panelRef={inspectorPanel}
            >
              <ScrollArea className="h-full">
                {/* The selected FX's settings take the Rack's place. */}
                {inspector.nodeId ? (
                  <div className="w-0 min-w-full px-1.5 py-3">
                    <NodeInspector
                      nodeId={inspector.nodeId}
                      onClose={inspector.close}
                    />
                  </div>
                ) : (
                  <div className="flex w-0 min-w-full flex-col gap-2 px-1.5 py-3">
                    <h2 className="px-2.5 font-medium text-muted-foreground text-xs">
                      Rack
                    </h2>
                    {rack}
                  </div>
                )}
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        <NodePalette
          isPhone={isPhone}
          onAdded={handlePaletteAdded}
          onClose={() => setPalette(null)}
          onLoadTemplate={loadTemplate}
          radios={[...(radios ?? []), ...management.sessionRadios]}
          request={palette}
          validateOptions={validateOptions}
        />

        {isPhone ? (
          <NodeInspector
            isPhone
            nodeId={inspector.nodeId}
            onClose={inspector.close}
            open={inspector.open}
          />
        ) : null}

        <ConnectDialog
          nodeId={connectNodeId}
          onClose={() => setConnectNodeId(null)}
          validateOptions={validateOptions}
        />

        {rewireEdgeId ? (
          <RewireDialog
            edgeId={rewireEdgeId}
            key={rewireEdgeId}
            onClose={() => setRewireEdgeId(null)}
            validateOptions={validateOptions}
          />
        ) : null}

        <RadioDialog
          mode={management.dialogMode}
          onOpenChange={management.setDialogOpen}
          open={management.dialogOpen}
          radio={management.selectedRadio}
        />

        <ConfirmDeleteDialog
          onCancel={handleCancelDelete}
          onConfirm={management.confirmDelete}
          radio={management.deleteConfirm}
        />
      </div>
    </NodeActionsProvider>
  );
}
