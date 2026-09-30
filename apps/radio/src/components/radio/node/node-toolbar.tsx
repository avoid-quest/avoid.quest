/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import { useStore } from "@tanstack/react-store";
import {
  CableIcon,
  ChevronDownIcon,
  LayoutTemplateIcon,
  PlusIcon,
  Redo2Icon,
  Undo2Icon,
} from "lucide-react";
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
import { isShortcutIgnored } from "./node-palette";

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
        isShortcutIgnored(event.target)
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
  store = nodeStore,
}: {
  onAdd: () => void;
  onLoadTemplate: (template: NodeTemplateId) => void;
  onRewire?: (edgeId: string) => void;
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
        <PlusIcon />
        <span className="max-sm:sr-only">Add</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost">
            <LayoutTemplateIcon className="sm:hidden" />
            <span className="max-sm:sr-only">Templates</span>
            <ChevronDownIcon className="max-sm:hidden" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {PALETTE_TEMPLATES.map((template) => (
            <DropdownMenuItem
              className="flex-col items-start gap-0.5"
              key={template.id}
              onSelect={() => onLoadTemplate(template.template)}
            >
              <span className="text-sm">{template.name}</span>
              <span className="text-muted-foreground text-xs">
                {template.description}
              </span>
            </DropdownMenuItem>
          ))}
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
          <CableIcon />
        </Button>
      ) : null}
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
        <Undo2Icon />
      </Button>
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
        <Redo2Icon />
      </Button>
    </div>
  );
}
