/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
/**
 * Inline editor for MIDI mapping transforms (invert, min/max, curve).
 */

import { Button } from "@avoid.quest/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Slider } from "@avoid.quest/ui/components/slider";
import { Switch } from "@avoid.quest/ui/components/switch";
import { type MouseEvent, useId } from "react";
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
  const invertId = useId();
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

  function updateInvert(invert: boolean) {
    updateMappingTransform({ invert });
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
      <label className="flex items-center gap-2 text-xs" htmlFor={invertId}>
        <Switch
          checked={transform.invert}
          id={invertId}
          onCheckedChange={updateInvert}
        />
        Invert
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
          aria-label="Transform minimum"
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
          aria-label="Transform maximum"
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
          <SelectTrigger aria-label="Curve" size="xs">
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
      <Button
        className="h-7 w-full text-muted-foreground text-xs"
        onClick={resetTransform}
        size="sm"
        variant="outline"
      >
        Reset transform
      </Button>
    </div>
  );
}
