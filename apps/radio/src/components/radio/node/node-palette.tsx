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
import { toast } from "sonner";
import {
  type PickerItem,
  PickerList,
  type PickerSection,
} from "@/components/audio/effect-picker";
import { getEffectMetadata, type Radio } from "@/lib/audio";
import { isMediaElementSinkIdSupported } from "@/lib/audio/utils";
import { isEffectNodeType } from "@/lib/node-graph/catalogue";
import { swapEffect } from "@/lib/node-graph/graph-edits";
import { isModulationType } from "@/lib/node-graph/modulation-schema";
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
  trackChip,
} from "@/lib/node-graph/palette";
import { NATIVE_NODE_TYPES, type NodeType } from "@/lib/node-graph/schema";
import type { NodeTemplateId } from "@/lib/node-graph/templates";
import type { ValidateOptions } from "@/lib/node-graph/validate";
import { platformSourceIcon } from "../platform-source-icon";
import { formatLocation } from "../station-row";
import { CONTROL_NODE_WIDTH } from "./control-node";
import { effectNodeWidth } from "./effect-node";
import { MERGE_WIDTH_PX } from "./merge-node";
import { type NativeNodeType, nativeNodeWidth } from "./native-strip-nodes";
import { nodeIcon } from "./node-icons";
import { useNodeDevices } from "./use-node-devices";

/** Where the palette was opened from, and so where its pick lands. */
export type PaletteRequest = {
  /** Flow position for the new node's top-left; a free spot when absent. */
  position?: { x: number; y: number };
  /** A cable dropped on empty space: the palette narrows to what fits it. */
  from?: PaletteFrom | null;
  /**
   * Which edge of the new node `position.x` names. "right" lands a picked
   * node's output port under a cable dragged back from an input, whatever
   * its width.
   */
  edge?: "left" | "right";
  /**
   * Where a cable was let go in space, in flow coordinates. The canvas
   * moves the picked node, once measured, so the port the cable takes sits
   * level with it.
   */
  drop?: { x: number; y: number };
  /** A cable selected with I: the pick goes into it. */
  into?: string | null;
  /** An FX node's "Swap effect…": the pick replaces its effect. */
  swap?: string | null;
};

/** A Station's node frame (w-60), and the width of anything not drawn as a module. */
const STATION_WIDTH = 240;

function drawnWidth(type: NodeType): number {
  if (isModulationType(type)) {
    return CONTROL_NODE_WIDTH;
  }
  if (isEffectNodeType(type)) {
    return effectNodeWidth(type);
  }
  if (isNativeNodeType(type)) {
    return nativeNodeWidth(type);
  }
  if (type === "merge") {
    return MERGE_WIDTH_PX;
  }
  return STATION_WIDTH;
}

function isNativeNodeType(type: NodeType): type is NativeNodeType {
  return (NATIVE_NODE_TYPES as readonly NodeType[]).includes(type);
}

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
  deviceIn: "A mic or line-in; pick its device on it",
  deviceOut: "Another output beside Speakers; pick its device on it",
  file: "A local file, or an MP3, M3U or PLS link",
  filter: "The station's own low- or high-pass, right after it",
  frequencySplit: "Lows, mids and highs down their own branches",
  fxComposite:
    "Parallel copies, each through its own FX. Or select two FX and press P",
  gain: "A level trim on the path, up to +12 dB",
  merge: "Joins a split's branches back into one",
  pan: "The station's own panner, right after it",
  // Platform names stay out, so typing one finds its own Track first.
  platform: "Search every platform, or paste a link",
  speakers: "The main output",
  station: "An empty slot; pick its station from its search",
  stereoSplit: "Left and right down their own branches",
};

const SECTION_TITLES = {
  fx: "FX",
  modulators: "Modulators",
  outputs: "Outputs",
  routing: "Routing",
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
      description: NODE_DESCRIPTIONS[entry.type] ?? metadata?.description,
      entry,
      icon: nodeIcon(entry.type),
      id: entry.id,
      name: entry.name,
    };
  }
  if (entry.searchPlatform) {
    const chip = trackChip(entry.searchPlatform);
    return {
      description: `Track: ${chip.description}`,
      entry,
      icon: platformSourceIcon(chip.icon),
      iconColor: chip.color,
      id: entry.id,
      name: entry.name,
    };
  }
  let description = NODE_DESCRIPTIONS[entry.type];
  if (entry.radio) {
    // Where a station is keeps the cards one line; its blurb would not.
    description =
      formatLocation(entry.radio.placeTitle, entry.radio.countryTitle) ||
      "Station";
  } else if (entry.device?.capture === "display") {
    description = "Share audio from another browser tab";
  } else if (entry.device) {
    description = entry.type === "deviceIn" ? "Audio input" : "Output device";
  }
  return {
    description,
    entry,
    icon: nodeIcon(entry.type),
    id: entry.id,
    name: entry.name,
  };
}

function toSections(
  entries: readonly PaletteEntry[]
): PickerSection<PaletteItem>[] {
  return (
    ["sources", "fx", "modulators", "routing", "outputs", "templates"] as const
  )
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

/** The palette's heading, hints and empty text for what it was opened for. */
function paletteCopy(request: PaletteRequest | null) {
  if (request?.swap) {
    return {
      description: "Cables stay. Enter swaps to the first match.",
      empty: "No effects found. Try a different search term.",
      placeholder: "Search effects…",
      title: "Swap effect",
    };
  }
  if (request?.into) {
    return {
      description: "Type to search. Enter inserts the first match.",
      empty: "Nothing here goes into this cable yet.",
      placeholder: "Search nodes…",
      title: "Insert into this cable",
    };
  }
  if (request?.from) {
    return {
      description: "Type to search. Enter adds the first match.",
      empty: "Nothing here takes this cable yet.",
      placeholder: "Search nodes and stations…",
      title: "Add a node to this cable",
    };
  }
  return {
    description: "Type to search. Enter adds the first match.",
    empty: "No nodes found. Try a different search term.",
    placeholder: "Search nodes and stations…",
    title: "Add node",
  };
}

/**
 * The add-node palette: Sources, FX, Routing, Outputs and Templates in the effect
 * picker's search-and-cards body. Sources list each audio input and Outputs
 * each output device the browser lists, the latter only where it can
 * choose an output. Picking a node adds it as one undo step,
 * wired into a dropped cable if there was one, inserted into a cable picked
 * with I, else a Station to Speakers. Opened for "Swap effect…", it lists
 * the effects an FX can become and swaps it in place.
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
  // Each input and output the browser lists gets its own entry.
  const devices = useNodeDevices({ enabled: open });
  const from = request?.from ?? null;
  const into = request?.into ?? null;
  const swap = request?.swap ?? null;
  const sections =
    open && graph
      ? toSections(
          paletteEntries(graph, {
            ...validateOptions,
            devices: { inputs: devices.inputs, outputs: devices.outputs },
            from,
            into,
            radios,
            sinkSelection: isMediaElementSinkIdSupported(),
            swap,
          })
        )
      : [];

  const handleSelect = ({ entry }: PaletteItem) => {
    const current = request ?? {};
    onClose();
    if (entry.kind === "template") {
      onLoadTemplate(entry.template);
      return;
    }
    const { swap: swapped } = current;
    if (swapped) {
      const { type } = entry;
      if (isEffectNodeType(type)) {
        commitNodeGraph(
          (latest) => swapEffect(latest, swapped, type),
          store,
          "snapshot"
        );
      }
      return;
    }
    let added: string | null = null;
    let refused: string | undefined;
    commitNodeGraph(
      (latest) => {
        const { edge, position } = current;
        const result = addPaletteNode(latest, entry, {
          ...validateOptions,
          from: current.from,
          into: current.into,
          position:
            position && edge === "right"
              ? { ...position, x: position.x - drawnWidth(entry.type) }
              : position,
        });
        added = result.nodeId;
        refused = result.message;
        return result.graph;
      },
      store,
      "snapshot"
    );
    if (refused) {
      toast(refused);
    }
    if (added) {
      onAdded?.(added, current);
    }
  };
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      onClose();
    }
  };

  const { description, empty, placeholder, title } = paletteCopy(request);
  const body = (
    <PickerList
      emptyText={empty}
      onSelect={handleSelect}
      placeholder={placeholder}
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
