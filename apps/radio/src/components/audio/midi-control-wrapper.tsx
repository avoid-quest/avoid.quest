/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
/**
 * Wraps any controllable UI element with MIDI learn context menu and badge.
 *
 * Right-click to learn/re-learn, edit transform, or clear mapping.
 * Shows a badge when a MIDI mapping exists.
 */

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@avoid.quest/ui/components/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import { type MouseEvent, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_TRANSFORM,
  getMidiControl,
  type MidiTargetId,
} from "@/lib/midi";
import { MidiBadge } from "./midi-badge";
import { MidiTransformEditor } from "./midi-transform-editor";

type MidiControlWrapperProps = {
  targetId: MidiTargetId;
  children: React.ReactNode;
};

export function MidiControlWrapper({
  targetId,
  children,
}: MidiControlWrapperProps) {
  const control = getMidiControl();
  const { mapping, isLearning: isThisLearning } = useSyncExternalStore(
    (listener) => control.subscribeTarget(targetId, listener),
    () => control.getTargetSnapshot(targetId),
    () => control.getTargetSnapshot(targetId)
  );
  const hasMidi = !!mapping;
  const [transformOpen, setTransformOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openingDialogRef = useRef<boolean>(false);
  function rememberControl(event: MouseEvent<HTMLDivElement>) {
    const wrapper = event.currentTarget;
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            'button, input, select, textarea, [tabindex], [role="slider"]'
          )
        : null;
    const active = document.activeElement;
    if (target && wrapper.contains(target)) {
      returnFocusRef.current = target;
    } else if (active instanceof HTMLElement && wrapper.contains(active)) {
      returnFocusRef.current = active;
    } else {
      returnFocusRef.current =
        wrapper.querySelector<HTMLElement>(
          'button, input, select, textarea, [tabindex], [role="slider"]'
        ) ?? wrapper;
    }
  }
  function openTransform() {
    openingDialogRef.current = true;
    setTransformOpen(true);
  }
  function closeMenu(event: Event) {
    if (openingDialogRef.current) {
      event.preventDefault();
      openingDialogRef.current = false;
    }
  }
  function returnToControl(event: Event) {
    event.preventDefault();
    if (returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus();
    }
  }
  function stopLearning() {
    control.change({ type: "stop-learn" });
  }

  function startLearning() {
    control.change({ targetId, type: "start-learn" });
  }

  function removeMapping() {
    control.change({ targetId, type: "remove-mapping" });
  }

  return (
    <Dialog onOpenChange={setTransformOpen} open={transformOpen}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="relative"
            data-midi-target={targetId}
            onContextMenuCapture={rememberControl}
            tabIndex={-1}
          >
            {hasMidi && <MidiBadge />}
            {!!isThisLearning && (
              <span className="pointer-events-none absolute inset-0 z-10 animate-pulse rounded border-2 border-primary border-dashed" />
            )}
            {children}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52" onCloseAutoFocus={closeMenu}>
          {isThisLearning ? (
            <ContextMenuItem onClick={stopLearning}>
              Cancel learn
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={startLearning}>
              {hasMidi ? "Re-learn MIDI control" : "Learn MIDI control"}
            </ContextMenuItem>
          )}

          {hasMidi && (
            <>
              <ContextMenuItem onSelect={openTransform}>
                Edit transform
              </ContextMenuItem>

              <ContextMenuSeparator />

              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onClick={removeMapping}
              >
                Clear mapping
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <DialogContent className="sm:max-w-sm" onCloseAutoFocus={returnToControl}>
        <DialogHeader>
          <DialogTitle>Edit MIDI transform</DialogTitle>
          <DialogDescription>
            Adjust the direction, range and response curve for this control.
          </DialogDescription>
        </DialogHeader>
        {mapping ? (
          <MidiTransformEditor
            targetId={targetId}
            transform={{ ...DEFAULT_TRANSFORM, ...mapping.transform }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
