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
import { useNodeSession } from "@/lib/hooks/use-node-session";
import { useAllRadios } from "@/lib/hooks/use-radios";
import { removeNodes } from "@/lib/node-graph/graph-edits";
import { commitNodeGraph, useNodeGraph } from "@/lib/node-graph/node-store";
import { RadioDialog } from "../../settings/radio-dialog";
import { ConfirmDeleteDialog } from "../confirm-delete-dialog";
import { NodeCanvasSkeleton } from "../radio-loading-skeleton";
import { RadioSearchBar } from "../radio-search-bar";
import { type NodeActions, NodeActionsProvider } from "./node-actions";
import { NodeRack } from "./node-rack";
import { NodeStage } from "./node-stage";
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
  const isPhone = useIsMobile();
  const management = useNodeRadioManagement({
    onStationAdded: (nodeId) => setReveal({ nodeId }),
    savedRadios: savedRadios.isReady ? savedRadios.data : undefined,
  });

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
    radios: radios ?? [],
    removeNode: (nodeId) => {
      commitNodeGraph((current) => removeNodes(current, [nodeId]));
    },
    saveDiscoveredStation: management.saveDiscoveredStation,
    selectDiscoveredForStation: management.selectDiscoveredForStation,
  };
  const handleSelectLocal = (radio: Radio) => {
    management.addStation(radio);
  };
  const handleCancelDelete = () => management.setDeleteConfirm(null);
  const handlePhoneViewChange = (value: string) => {
    if (isPhoneView(value)) {
      setPhoneView(value);
    }
  };

  const canvas = (
    <div className="relative h-full min-h-0">
      {graph ? (
        <ClientOnly fallback={<NodeCanvasSkeleton />}>
          <Suspense fallback={<NodeCanvasSkeleton />}>
            <NodeCanvas reveal={reveal} />
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
        <div className="px-3 pt-3 pb-2">
          <RadioSearchBar
            className="w-full max-w-md"
            onSaveDiscovered={management.saveDiscoveredStation}
            onSelectDiscovered={management.selectDiscoveredStation}
            onSelectLocal={handleSelectLocal}
            placeholder="Search to add a station"
            radios={radios ?? []}
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
                <div className="flex w-0 min-w-full flex-col gap-2 px-1.5 py-3">
                  <h2 className="px-2.5 font-medium text-muted-foreground text-xs">
                    Rack
                  </h2>
                  {rack}
                </div>
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

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
