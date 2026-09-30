/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import { Knob } from "@avoid.quest/ui/components/knob";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Switch } from "@avoid.quest/ui/components/switch";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  type LucideIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import { useThrottledParam } from "@/lib/hooks/use-throttled-param";
import {
  getNodeDefinition,
  isShipped,
  type NodePort,
  portHandleId,
} from "@/lib/node-graph/catalogue";
import { portName } from "@/lib/node-graph/describe";
import type { NodeType } from "@/lib/node-graph/schema";
import { Handle, Position } from "./flow-adapter";

/**
 * Module Frame
 *
 * The chrome FX and native strip nodes share: a flat card of fixed width,
 * a header with an icon tile, the title, an optional enable switch and a
 * menu, and a body of 64 px control columns. Each control has a sans label
 * above an uncaptioned knob, so no mono caps reach node chrome.
 */

/** React Flow skips drag, pan and wheel zoom on these, so controls work. */
export const INTERACTIVE = "nodrag nopan nowheel";

/**
 * Keeps a node control's keys on the node: an arrow turns a knob instead of
 * moving the node, and Enter, Escape or Delete don't select, deselect or
 * delete it. A menu or select portals out of the node but still bubbles
 * through React, so its keys stop here too. Chords like Cmd+Z go on to the
 * app's shortcuts, so undo works from a focused knob.
 */
export function keepControlKeys(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.length === 1) {
    return;
  }
  event.stopPropagation();
}

/** One control column: the shared Knob's own width (w-16). */
export const CONTROL_COLUMN_PX = 64;
/** A body shows at most this many columns: the first layout row. */
export const MAX_CONTROL_COLUMNS = 4;
const COLUMN_GAP_PX = 8;
const BODY_PADDING_PX = 16;
/** A fader release lands after the 32 ms param throttle's trailing call. */
export const RELEASE_DELAY_MS = 48;

/** The node width for `columns` controls, never narrower than `minColumns`. */
export function moduleWidth(columns: number, minColumns: number): number {
  const count = Math.min(MAX_CONTROL_COLUMNS, Math.max(minColumns, columns, 1));
  return (
    BODY_PADDING_PX + count * CONTROL_COLUMN_PX + (count - 1) * COLUMN_GAP_PX
  );
}

export function ModuleFrame({
  width,
  on,
  selected = false,
  children,
}: {
  width: number;
  /** An enabled effect: the canon `border-primary/20 bg-primary/5`. */
  on: boolean;
  selected?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-card text-card-foreground",
        on ? "border-primary/20" : "border-border/50",
        selected && "border-ring"
      )}
      style={{ width }}
    >
      {/* The tint sits on an opaque card so cables never show through. */}
      <div className={cn("rounded-[inherit]", on && "bg-primary/5")}>
        {children}
      </div>
    </div>
  );
}

export function ModuleHeader({
  icon: Icon,
  title,
  on,
  badge,
  enabled,
  onEnabledChange,
  onInspect,
  onReset,
  onRemove,
}: {
  icon: LucideIcon;
  title: string;
  on: boolean;
  badge?: ReactNode;
  /** Set on effects: the header carries their enable switch. */
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  /** Opens every param in the inspector. */
  onInspect?: () => void;
  /** Set when the node has params to put back; a Merge has none. */
  onReset?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex h-8 items-center gap-1.5 pr-1 pl-2">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-sm",
          on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-medium text-xs",
          enabled === false && "text-muted-foreground"
        )}
        title={title}
      >
        {title}
      </span>
      {badge}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
      <div
        className={cn("flex shrink-0 items-center gap-1", INTERACTIVE)}
        onKeyDown={keepControlKeys}
      >
        {onEnabledChange && enabled !== undefined ? (
          <Switch
            aria-label={`${title} on`}
            checked={enabled}
            onCheckedChange={onEnabledChange}
          />
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`Options for ${title}`}
              className="size-6 text-muted-foreground"
              size="icon"
              variant="ghost"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onInspect ? (
              <DropdownMenuItem onClick={onInspect}>
                <SlidersHorizontalIcon />
                All settings
              </DropdownMenuItem>
            ) : null}
            {onReset ? (
              <DropdownMenuItem onClick={onReset}>
                <RotateCcwIcon />
                Reset to defaults
              </DropdownMenuItem>
            ) : null}
            {onInspect || onReset ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onClick={onRemove} variant="destructive">
              <Trash2Icon />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * The body's control row. Keys stay here (`keepControlKeys`): an arrow on a
 * focused knob turns it instead of moving the node, and Delete or C don't
 * reach the canvas.
 * A pointer or key release is where the patch takes an undo step.
 */
export function ModuleControls({
  onRelease,
  children,
}: {
  onRelease: () => void;
  children: ReactNode;
}) {
  const release = () => {
    setTimeout(onRelease, RELEASE_DELAY_MS);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself
    <div
      className={cn(
        "flex items-start gap-x-2 rounded-b-[inherit] border-border/50 border-t bg-muted/30 px-2 py-2",
        INTERACTIVE
      )}
      onKeyDown={keepControlKeys}
      onKeyUp={release}
      onPointerUp={release}
    >
      {children}
    </div>
  );
}

/** A control column: its sans label above the control. */
function ControlColumn({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-1">
      <span
        className="w-full truncate text-center text-[10px] text-muted-foreground leading-none"
        title={label}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export type ModuleKnobProps = {
  label: string;
  /** Accessible name, e.g. "Compressor threshold". */
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  bipolar?: boolean;
  scale?: "linear" | "log";
  format: (value: number) => string;
  description?: string;
  /** Right-click learns MIDI for it: `node:<nodeId>:<paramKey>`. */
  midiTargetId?: string;
  onChange: (value: number) => void;
};

/**
 * The shared Knob without its caption, throttled like every param knob,
 * and MIDI-learnable when it has a target.
 */
export function ModuleKnob({
  label,
  name,
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  bipolar,
  scale,
  format,
  description,
  midiTargetId,
  onChange,
}: ModuleKnobProps) {
  const throttledOnChange = useThrottledParam(onChange);
  const knob = (
    <Knob
      ariaLabel={name}
      bipolar={bipolar ?? (defaultValue !== undefined && min < 0 && max > 0)}
      defaultValue={defaultValue}
      format={format}
      max={max}
      min={min}
      onChange={throttledOnChange}
      scale={scale}
      size={36}
      step={step}
      title={description ? `${label}: ${description}` : label}
      value={value}
    />
  );
  return (
    <ControlColumn label={label}>
      {midiTargetId ? (
        <MidiControlWrapper targetId={midiTargetId}>{knob}</MidiControlWrapper>
      ) : (
        knob
      )}
    </ControlColumn>
  );
}

export function ModuleSelect({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  /** `short` is what the 64 px trigger shows, e.g. "Low" for "Low-pass". */
  options: readonly { value: string; label: string; short?: string }[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <ControlColumn label={label}>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger
          aria-label={name}
          className="w-full gap-1 px-1.5 text-[10px] data-[size=xs]:px-1.5 data-[size=xs]:text-[10px] [&_svg:not([class*='size-'])]:size-3"
          size="xs"
          title={selected?.label}
        >
          <SelectValue>{selected?.short ?? selected?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ControlColumn>
  );
}

export function ModuleSwitch({
  label,
  name,
  checked,
  description,
  onChange,
}: {
  label: string;
  name: string;
  checked: boolean;
  description?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <ControlColumn label={label}>
      <div className="flex h-9 items-center" title={description}>
        <Switch
          aria-label={name}
          checked={checked}
          onCheckedChange={onChange}
        />
      </div>
    </ControlColumn>
  );
}

/**
 * "Threshold" on a Compressor reads as "Compressor threshold"; a control
 * named like its node (Pan's pan) reads as the node.
 */
export function controlName(title: string, label: string): string {
  if (label.toLowerCase() === title.toLowerCase()) {
    return title;
  }
  return `${title} ${label.length > 1 ? label.toLowerCase() : label}`;
}

/**
 * A node's shipped ports as React Flow handles: inputs down the left edge,
 * outputs down the right, spread evenly. A key input wears the amber ring.
 * A split shows only the outputs it has in use (`outputIds`),
 * named for its branches (`portLabel`).
 */
export function ModulePorts({
  type,
  title,
  outputIds,
  portLabel = portName,
}: {
  type: NodeType;
  title: string;
  outputIds?: readonly string[];
  portLabel?: (port: NodePort) => string;
}) {
  const definition = getNodeDefinition(type);
  const ports = definition.ports.filter(
    (port) =>
      isShipped(port.ship ?? definition.ship, "v1") &&
      (port.direction === "in" || !outputIds || outputIds.includes(port.id))
  );
  const inputs = ports.filter((port) => port.direction === "in");
  const outputs = ports.filter((port) => port.direction === "out");
  const handles = (side: typeof inputs, position: Position) =>
    side.map((port, index) => {
      const name = portLabel(port);
      return (
        <Handle
          aria-label={`${title} ${name.toLowerCase()}`}
          className={cn(
            "node-port",
            port.kind === "sidechain" && "node-port-key"
          )}
          id={portHandleId(port)}
          key={portHandleId(port)}
          position={position}
          style={
            side.length > 1
              ? { top: `${((index + 1) / (side.length + 1)) * 100}%` }
              : undefined
          }
          title={name}
          type={port.direction === "in" ? "target" : "source"}
        />
      );
    });
  return (
    <>
      {handles(inputs, Position.Left)}
      {handles(outputs, Position.Right)}
    </>
  );
}
