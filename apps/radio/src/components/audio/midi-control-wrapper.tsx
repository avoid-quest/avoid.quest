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
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@avoid.quest/ui/components/context-menu";
import { useMidiControlSnapshot } from "@/lib/hooks/use-midi";
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
  const snapshot = useMidiControlSnapshot();
  const { learningTarget } = snapshot;
  const mapping = snapshot.mappingsByTarget.get(targetId);
  const hasMidi = !!mapping;
  const isThisLearning = learningTarget === targetId;
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative" data-midi-target={targetId}>
          {hasMidi && <MidiBadge />}
          {isThisLearning && (
            <span className="pointer-events-none absolute inset-0 z-10 animate-pulse rounded border-2 border-primary border-dashed" />
          )}
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {isThisLearning ? (
          <ContextMenuItem onClick={stopLearning}>Cancel learn</ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={startLearning}>
            {hasMidi ? "Re-learn MIDI control" : "Learn MIDI control"}
          </ContextMenuItem>
        )}

        {hasMidi && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Edit transform</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-56">
                <MidiTransformEditor
                  targetId={targetId}
                  transform={{ ...DEFAULT_TRANSFORM, ...mapping.transform }}
                />
              </ContextMenuSubContent>
            </ContextMenuSub>

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
  );
}
