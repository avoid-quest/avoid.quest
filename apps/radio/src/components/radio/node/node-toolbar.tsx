/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsMaximize,
  IconChevronDown,
  IconDots,
  IconLayoutBoard,
  IconPlug,
  IconPlus,
} from "@tabler/icons-react";
import { useStore } from "@tanstack/react-store";
import { useEffect } from "react";
import {
  type NodeStore,
  nodeStore,
  redoNodeGraph,
  undoNodeGraph,
  useNodeHistory,
} from "@/lib/node-graph/node-store";
import { PALETTE_TEMPLATES } from "@/lib/node-graph/palette";
import type { NodeTemplateId } from "@/lib/node-graph/templates";

/** Patch shortcuts also work on non-text controls in the phone inspector. */
function ignoresUndo(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (
    target.isContentEditable ||
    target.closest(
      "input, textarea, select, [contenteditable=true], [role=menu], [role=listbox], [role=alertdialog]"
    )
  ) {
    return true;
  }
  const dialog = target.closest('[role="dialog"]');
  return dialog !== null && !dialog.hasAttribute("data-node-inspector");
}

/**
 * Cmd+Z undoes a patch edit and Shift+Cmd+Z redoes it (Ctrl elsewhere).
 * Fields keep their own text undo.
 */
export function useUndoShortcuts(store: NodeStore = nodeStore) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "z" ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.defaultPrevented ||
        ignoresUndo(event.target)
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        redoNodeGraph(store);
      } else {
        undoNodeGraph(store);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store]);
}

/**
 * Patch editing beside the search bar: + Add (the palette, also on `/`),
 * the Templates menu, and Undo / Redo.
 */
export function NodeToolbar({
  onAdd,
  onLoadTemplate,
  onRewire,
  onFitView,
  isPhone = false,
  store = nodeStore,
}: {
  onAdd: () => void;
  onLoadTemplate: (template: NodeTemplateId) => void;
  onRewire?: (edgeId: string) => void;
  onFitView?: () => void;
  isPhone?: boolean;
  store?: NodeStore;
}) {
  const { canRedo, canUndo } = useNodeHistory(store);
  const edgeId = useStore(store, (state) =>
    state.selection.edges.length === 1 ? state.selection.edges[0] : null
  );
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        aria-keyshortcuts="/"
        onClick={onAdd}
        size="sm"
        title="Add a node (/)"
        variant="outline"
      >
        <IconPlus />
        <span className="max-sm:sr-only">Add</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={isPhone ? "Patch actions" : undefined}
              size="sm"
              variant="ghost"
            >
              {isPhone ? (
                <IconDots />
              ) : (
                <>
                  <IconLayoutBoard className="sm:hidden" />
                  <span className="max-sm:sr-only">Templates</span>
                  <IconChevronDown className="max-sm:hidden" />
                </>
              )}
            </Button>
          }
        />
        <DropdownMenuContent align={isPhone ? "end" : "start"} className="w-64">
          {isPhone ? (
            <>
              {onFitView ? (
                <DropdownMenuItem onClick={onFitView}>
                  <IconArrowsMaximize /> Fit view
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={!canUndo}
                onClick={() => undoNodeGraph(store)}
              >
                <IconArrowBackUp /> Undo
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canRedo}
                onClick={() => redoNodeGraph(store)}
              >
                <IconArrowForwardUp /> Redo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            {isPhone ? <DropdownMenuLabel>Templates</DropdownMenuLabel> : null}
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              Replaces this patch. Undo restores it.
            </p>
            {PALETTE_TEMPLATES.map((template) => (
              <DropdownMenuItem
                className="flex-col items-start gap-0.5"
                key={template.id}
                onClick={() => onLoadTemplate(template.template)}
              >
                <span className="text-sm">{template.name}</span>
                <span className="text-muted-foreground text-xs">
                  {template.description}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {edgeId && onRewire ? (
        <Button
          aria-label="Rewire selected cable"
          onClick={() => onRewire(edgeId)}
          size="icon"
          title="Rewire selected cable"
          variant="outline"
        >
          <IconPlug />
        </Button>
      ) : null}
      {isPhone ? null : (
        <Button
          aria-keyshortcuts="Meta+Z Control+Z"
          aria-label="Undo"
          className="size-8 text-muted-foreground"
          disabled={!canUndo}
          onClick={() => undoNodeGraph(store)}
          size="icon"
          title="Undo (⌘Z)"
          variant="ghost"
        >
          <IconArrowBackUp />
        </Button>
      )}
      {isPhone ? null : (
        <Button
          aria-keyshortcuts="Shift+Meta+Z Shift+Control+Z"
          aria-label="Redo"
          className="size-8 text-muted-foreground"
          disabled={!canRedo}
          onClick={() => redoNodeGraph(store)}
          size="icon"
          title="Redo (⇧⌘Z)"
          variant="ghost"
        >
          <IconArrowForwardUp />
        </Button>
      )}
    </div>
  );
}
