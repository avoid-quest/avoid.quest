/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
/**
 * Inline editor for MIDI mapping transforms (invert, min/max, curve).
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Slider } from "@avoid.quest/ui/components/slider";
import type { ChangeEvent, MouseEvent } from "react";
import {
  DEFAULT_TRANSFORM,
  getMidiControl,
  type MidiTargetId,
  type MidiTransform,
} from "@/lib/midi";

type MidiTransformEditorProps = {
  targetId: MidiTargetId;
  transform: MidiTransform;
};

export function MidiTransformEditor({
  targetId,
  transform,
}: MidiTransformEditorProps) {
  function updateMappingTransform(patch: Partial<MidiTransform>) {
    getMidiControl().change({
      patch,
      targetId,
      type: "update-transform",
    });
  }

  function stopClickPropagation(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  function updateInvert(event: ChangeEvent<HTMLInputElement>) {
    updateMappingTransform({ invert: event.target.checked });
  }

  function updateMin([min]: number[]) {
    updateMappingTransform({ min });
  }

  function updateMax([max]: number[]) {
    updateMappingTransform({ max });
  }

  function updateCurve(curve: MidiTransform["curve"]) {
    updateMappingTransform({ curve });
  }

  function resetTransform() {
    updateMappingTransform({ ...DEFAULT_TRANSFORM });
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation for context menu
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stopPropagation for context menu
    // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation for context menu
    <div className="space-y-3 p-2" onClick={stopClickPropagation}>
      {/* Invert */}
      <label className="flex items-center gap-2">
        <input
          checked={transform.invert}
          className="size-3.5 cursor-pointer accent-violet-500"
          onChange={updateInvert}
          type="checkbox"
        />
        <span className="text-xs">Invert</span>
      </label>

      {/* Min */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Min</span>
          <span className="font-mono text-muted-foreground text-xs">
            {transform.min.toFixed(2)}
          </span>
        </div>
        <Slider
          defaultValue={[DEFAULT_TRANSFORM.min]}
          max={1}
          min={0}
          onValueChange={updateMin}
          step={0.01}
          value={[transform.min]}
        />
      </div>

      {/* Max */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Max</span>
          <span className="font-mono text-muted-foreground text-xs">
            {transform.max.toFixed(2)}
          </span>
        </div>
        <Slider
          defaultValue={[DEFAULT_TRANSFORM.max]}
          max={1}
          min={0}
          onValueChange={updateMax}
          step={0.01}
          value={[transform.max]}
        />
      </div>

      {/* Curve */}
      <div className="space-y-0.5">
        <span className="text-muted-foreground text-xs">Curve</span>
        <Select onValueChange={updateCurve} value={transform.curve}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linear">Linear</SelectItem>
            <SelectItem value="log">Logarithmic</SelectItem>
            <SelectItem value="exp">Exponential</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Reset */}
      <button
        className="w-full rounded-md border px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted"
        onClick={resetTransform}
        type="button"
      >
        Reset Transform
      </button>
    </div>
  );
}
