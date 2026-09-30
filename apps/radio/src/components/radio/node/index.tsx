/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@avoid.quest/ui/components/resizable";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import { lazy, Suspense, useEffect, useState } from "react";
import { ClientOnly } from "@/components/client-only";
import type { Radio } from "@/lib/audio";
import { useMediaSession } from "@/lib/hooks/use-media-session";
import { useNodeMidi } from "@/lib/hooks/use-node-midi";
import { useNodeSession } from "@/lib/hooks/use-node-session";
import { useAllRadios } from "@/lib/hooks/use-radios";
import {
  findStationNode,
  removeNodesHealed,
} from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  nodeStore,
  useNodeGraph,
} from "@/lib/node-graph/node-store";
import {
  buildNodeGraphFromTemplate,
  type NodeTemplateId,
} from "@/lib/node-graph/templates";
import { detectNodePlaybackEnv } from "@/lib/node-playback";
import { RadioDialog } from "../../settings/radio-dialog";
import { ConfirmDeleteDialog } from "../confirm-delete-dialog";
import { NodeCanvasSkeleton } from "../radio-loading-skeleton";
import { RadioSearchBar } from "../radio-search-bar";
import { ConnectDialog } from "./connect-dialog";
import { type NodeActions, NodeActionsProvider } from "./node-actions";
import { NodeInspector, useNodeInspector } from "./node-inspector";
import {
  NodePalette,
  type PaletteRequest,
  usePaletteShortcut,
} from "./node-palette";
import { NodeRack } from "./node-rack";
import { NodeStage } from "./node-stage";
import { NodeToolbar, useUndoShortcuts } from "./node-toolbar";
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

/** The phone views; Stage is where a phone patch opens. */
const PHONE_VIEWS = ["stage", "rack", "patch"] as const;
type PhoneView = (typeof PHONE_VIEWS)[number];

function isPhoneView(value: string): value is PhoneView {
  return (PHONE_VIEWS as readonly string[]).includes(value);
}

export function NodeRadios({ radios }: { radios?: Radio[] }) {
  const graph = useNodeGraph();
  const savedRadios = useAllRadios();
  const { pauseAll, playAll, playingCount, sources } = useNodeSession();
  const [reveal, setReveal] = useState<{ nodeId: string } | null>(null);
  const [phoneView, setPhoneView] = useState<PhoneView>("stage");
  const [palette, setPalette] = useState<PaletteRequest | null>(null);
  const [connectNodeId, setConnectNodeId] = useState<string | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const isPhone = useIsMobile();
  const inspector = useNodeInspector({ isPhone });
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
      (current) => ({
        ...buildNodeGraphFromTemplate(template, {
          // A station already in the patch keeps its level.
          levels: (radio) => {
            const station = findStationNode(current, radio);
            return station
              ? { muted: station.data.muted, volume: station.data.volume }
              : undefined;
          },
          saved,
          session: management.sessionRadios,
        }),
        viewport: current.viewport,
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
    fillStation: management.fillStation,
    handleDeleteRadio: management.handleDeleteRadio,
    handleEditRadio: management.handleEditRadio,
    handleSaveSessionRadio: management.handleSaveSessionRadio,
    handleToggleRadio: management.handleToggleRadio,
    inspectNode: inspector.inspect,
    radios: radios ?? [],
    removeNode: (nodeId) => {
      commitNodeGraph(
        (current) => removeNodesHealed(current, [nodeId], validateOptions),
        nodeStore,
        "snapshot"
      );
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
    if (!request.position) {
      setReveal({ nodeId });
    }
  };
  const handlePhoneViewChange = (value: string) => {
    if (isPhoneView(value)) {
      setPhoneView(value);
      // A Station added from the Stage or Rack is already in view there;
      // opening the Patch later must fit the view, not pan to a stale add.
      setReveal(null);
    }
  };

  const canvas = (
    <div className="relative h-full min-h-0">
      {graph ? (
        <ClientOnly fallback={<NodeCanvasSkeleton />}>
          <Suspense fallback={<NodeCanvasSkeleton />}>
            <NodeCanvas
              fitRequest={fitRequest}
              onOpenConnect={setConnectNodeId}
              onOpenPalette={openPalette}
              reveal={reveal}
            />
          </Suspense>
        </ClientOnly>
      ) : (
        <NodeCanvasSkeleton />
      )}
      <p className="pointer-events-none absolute bottom-2 left-3 z-10 text-muted-foreground text-xs">
        Drag a cable to empty space to add a node
      </p>
    </div>
  );
  const rack = graph ? <NodeRack graph={graph} /> : null;

  return (
    <NodeActionsProvider value={actions}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <RadioSearchBar
            className="w-full min-w-0 max-w-md"
            onSaveDiscovered={management.saveDiscoveredStation}
            onSelectDiscovered={management.selectDiscoveredStation}
            onSelectLocal={handleSelectLocal}
            placeholder="Search to add a station"
            radios={radios ?? []}
          />
          <NodeToolbar
            onAdd={() => openPalette()}
            onLoadTemplate={loadTemplate}
          />
        </div>
        {isPhone ? (
          <Tabs
            className="min-h-0 flex-1 gap-0"
            onValueChange={handlePhoneViewChange}
            value={phoneView}
          >
            <div className="px-3 pb-2">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger className="text-xs" value="stage">
                  Stage
                </TabsTrigger>
                <TabsTrigger className="text-xs" value="rack">
                  Rack
                </TabsTrigger>
                <TabsTrigger className="text-xs" value="patch">
                  Patch
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent
              className="min-h-0 overflow-y-auto px-3 pb-3"
              value="stage"
            >
              <NodeStage />
            </TabsContent>
            <TabsContent
              className="min-h-0 overflow-y-auto px-1.5 pb-3"
              value="rack"
            >
              {rack}
            </TabsContent>
            <TabsContent className="min-h-0" value="patch">
              {canvas}
            </TabsContent>
          </Tabs>
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
