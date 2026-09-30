/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { lazy, Suspense, useEffect, useState } from "react";
import { ClientOnly } from "@/components/client-only";
import type { Radio } from "@/lib/audio";
import { useNodeSession } from "@/lib/hooks/use-node-session";
import { useAllRadios } from "@/lib/hooks/use-radios";
import { removeNodes } from "@/lib/node-graph/graph-edits";
import { commitNodeGraph, useNodeGraph } from "@/lib/node-graph/node-store";
import { RadioDialog } from "../../settings/radio-dialog";
import { ConfirmDeleteDialog } from "../confirm-delete-dialog";
import { NodeCanvasSkeleton } from "../radio-loading-skeleton";
import { RadioSearchBar } from "../radio-search-bar";
import { type NodeActions, NodeActionsProvider } from "./node-actions";
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
  "input, textarea, select, button, a, summary, [role=slider], [role=menuitem], [role=option], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=combobox], [role=dialog], [role=menu]";

export function NodeRadios({ radios }: { radios?: Radio[] }) {
  const graph = useNodeGraph();
  const savedRadios = useAllRadios();
  const { pauseAll, playAll, playingCount, sources } = useNodeSession();
  const [reveal, setReveal] = useState<{ nodeId: string } | null>(null);
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
        target instanceof HTMLElement &&
        (target.isContentEditable ||
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
        <div className="relative min-h-0 flex-1">
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
