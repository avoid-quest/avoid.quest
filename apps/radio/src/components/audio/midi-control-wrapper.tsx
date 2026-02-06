/**
 * Wraps any controllable UI element with MIDI learn context menu and badge.
 *
 * Right-click to learn/re-learn, edit transform, or clear mapping.
 * Shows a violet badge when a MIDI mapping exists.
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
import { DEFAULT_TRANSFORM, type MidiTargetId, useMidiStore } from "@/lib/midi";
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
  const learningTarget = useMidiStore((s) => s.learningTarget);
  const mapping = useMidiStore((s) => s.mappingsByTarget.get(targetId));
  const startLearn = useMidiStore((s) => s.startLearn);
  const stopLearn = useMidiStore((s) => s.stopLearn);
  const removeMapping = useMidiStore((s) => s.removeMapping);
  const hasMidi = !!mapping;
  const isThisLearning = learningTarget === targetId;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative">
          {hasMidi && <MidiBadge />}
          {isThisLearning && (
            <span className="pointer-events-none absolute inset-0 z-10 animate-pulse rounded border-2 border-violet-500/50" />
          )}
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {isThisLearning ? (
          <ContextMenuItem onClick={() => stopLearn()}>
            Cancel Learn
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => startLearn(targetId)}>
            {hasMidi ? "Re-learn MIDI" : "Learn MIDI"}
          </ContextMenuItem>
        )}

        {hasMidi && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Edit Transform</ContextMenuSubTrigger>
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
              onClick={() => removeMapping(targetId)}
            >
              Clear Mapping
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
