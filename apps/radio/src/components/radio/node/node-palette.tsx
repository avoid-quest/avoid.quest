/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@avoid.quest/ui/components/drawer";
import { LayoutTemplateIcon } from "lucide-react";
import { useEffect } from "react";
import {
  type PickerItem,
  PickerList,
  type PickerSection,
} from "@/components/audio/effect-picker";
import { getEffectMetadata, type Radio } from "@/lib/audio";
import { isEffectNodeType } from "@/lib/node-graph/catalogue";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  useNodeGraph,
} from "@/lib/node-graph/node-store";
import {
  addPaletteNode,
  type PaletteEntry,
  type PaletteFrom,
  paletteEntries,
} from "@/lib/node-graph/palette";
import type { NodeType } from "@/lib/node-graph/schema";
import type { NodeTemplateId } from "@/lib/node-graph/templates";
import type { ValidateOptions } from "@/lib/node-graph/validate";
import { formatLocation } from "../station-row";
import { nodeIcon } from "./node-icons";

/** Where the palette was opened from, and so where its pick lands. */
export type PaletteRequest = {
  /** Flow position for the new node's top-left; a free spot when absent. */
  position?: { x: number; y: number };
  /** A cable dropped on empty space: the palette narrows to what fits it. */
  from?: PaletteFrom | null;
};

/** Keys that type into a field or act inside a menu or dialog. */
const SHORTCUT_IGNORED_TARGETS =
  "input, textarea, select, [contenteditable=true], [role=menu], [role=listbox], [role=dialog], [role=alertdialog]";

export function isShortcutIgnored(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(SHORTCUT_IGNORED_TARGETS) !== null)
  );
}

/** Controls on a node that act on their own keys, Backspace and C included. */
const CANVAS_KEY_IGNORED_CONTROLS =
  "button, a[href], [role=button], [role=slider], [role=menuitem], [role=switch], [role=checkbox]";

/**
 * Canvas keys (C, Delete) act from the canvas, or with nothing focused;
 * not from a field, a dialog, a control on a node, the Stage or the Rack.
 */
export function isCanvasKey(
  target: EventTarget | null,
  canvas: HTMLElement | null
): boolean {
  return (
    !(
      isShortcutIgnored(target) ||
      (target instanceof HTMLElement &&
        target.closest(CANVAS_KEY_IGNORED_CONTROLS) !== null)
    ) &&
    (target === document.body ||
      (target instanceof Node && canvas?.contains(target) === true))
  );
}

/** `/` opens the palette, unless typing or inside a menu or dialog. */
export function usePaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        isShortcutIgnored(event.target)
      ) {
        return;
      }
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpen]);
}

const NODE_DESCRIPTIONS: Partial<Record<NodeType, string>> = {
  filter: "The station's own low- or high-pass, right after it",
  gain: "A level trim on the path, up to +12 dB",
  pan: "The station's own panner, right after it",
  speakers: "The main output",
  station: "An empty slot; pick its station from its search",
};

const SECTION_TITLES = {
  fx: "FX",
  outputs: "Outputs",
  sources: "Sources",
  templates: "Templates",
} as const;

type PaletteItem = PickerItem & { entry: PaletteEntry };

function toItem(entry: PaletteEntry): PaletteItem {
  if (entry.kind === "template") {
    return {
      description: entry.description,
      entry,
      icon: LayoutTemplateIcon,
      id: entry.id,
      name: entry.name,
    };
  }
  if (isEffectNodeType(entry.type)) {
    const metadata = getEffectMetadata(entry.type);
    return {
      badge: metadata?.family,
      description: metadata?.description,
      entry,
      icon: nodeIcon(entry.type),
      id: entry.id,
      name: entry.name,
    };
  }
  return {
    // Where a station is keeps the cards one line; its blurb would not.
    description: entry.radio
      ? formatLocation(entry.radio.placeTitle, entry.radio.countryTitle) ||
        "Station"
      : NODE_DESCRIPTIONS[entry.type],
    entry,
    icon: nodeIcon(entry.type),
    id: entry.id,
    name: entry.name,
  };
}

function toSections(
  entries: readonly PaletteEntry[]
): PickerSection<PaletteItem>[] {
  return (["sources", "fx", "outputs", "templates"] as const)
    .map((section) => ({
      items: entries.filter((entry) => entry.section === section).map(toItem),
      title: SECTION_TITLES[section],
    }))
    .filter((section) => section.items.length > 0);
}

type NodePaletteProps = {
  /** null while closed. */
  request: PaletteRequest | null;
  onClose: () => void;
  /** Stations a Station entry can come filled with. */
  radios: readonly Radio[];
  onLoadTemplate: (template: NodeTemplateId) => void;
  /** A node the palette added, e.g. to pan it into view. */
  onAdded?: (nodeId: string, request: PaletteRequest) => void;
  /** Phones get a bottom drawer instead of a dialog. */
  isPhone?: boolean;
  validateOptions?: ValidateOptions;
  store?: NodeStore;
};

/**
 * The add-node palette: Sources, FX, Outputs and Templates in the effect
 * picker's search-and-cards body. Picking a node adds it as one undo step,
 * wired into a dropped cable if there was one, else a Station to Speakers.
 */
export function NodePalette({
  request,
  onClose,
  radios,
  onLoadTemplate,
  onAdded,
  isPhone = false,
  validateOptions,
  store = nodeStore,
}: NodePaletteProps) {
  const graph = useNodeGraph(store);
  const open = request !== null && graph !== null;
  const from = request?.from ?? null;
  const sections =
    open && graph
      ? toSections(paletteEntries(graph, { ...validateOptions, from, radios }))
      : [];

  const handleSelect = ({ entry }: PaletteItem) => {
    const current = request ?? {};
    onClose();
    if (entry.kind === "template") {
      onLoadTemplate(entry.template);
      return;
    }
    let added: string | null = null;
    commitNodeGraph(
      (latest) => {
        const result = addPaletteNode(latest, entry, {
          ...validateOptions,
          from: current.from,
          position: current.position,
        });
        added = result.nodeId;
        return result.graph;
      },
      store,
      "snapshot"
    );
    if (added) {
      onAdded?.(added, current);
    }
  };
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      onClose();
    }
  };

  const title = from ? "Add a node to this cable" : "Add node";
  const description = "Type to search. Enter adds the first match.";
  const body = (
    <PickerList
      emptyText={
        from
          ? "Nothing here takes this cable yet."
          : "No nodes found. Try a different search term."
      }
      onSelect={handleSelect}
      placeholder="Search nodes and stations…"
      sections={sections}
    />
  );

  if (isPhone) {
    return (
      <Drawer onOpenChange={handleOpenChange} open={open}>
        <DrawerContent>
          <DrawerHeader className="pb-2">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription className="sr-only">
              {description}
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 px-4 pb-4">{body}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
