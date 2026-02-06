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
import {
  DEFAULT_TRANSFORM,
  type MidiTargetId,
  type MidiTransform,
  useMidiStore,
} from "@/lib/midi";

type MidiTransformEditorProps = {
  targetId: MidiTargetId;
  transform: MidiTransform;
};

export function MidiTransformEditor({
  targetId,
  transform,
}: MidiTransformEditorProps) {
  const updateMappingTransform = useMidiStore((s) => s.updateMappingTransform);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation for context menu
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stopPropagation for context menu
    // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation for context menu
    <div className="space-y-3 p-2" onClick={(e) => e.stopPropagation()}>
      {/* Invert */}
      <label className="flex items-center gap-2">
        <input
          checked={transform.invert}
          className="size-3.5 cursor-pointer accent-violet-500"
          onChange={(e) =>
            updateMappingTransform(targetId, { invert: e.target.checked })
          }
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
          onValueChange={([v]) => updateMappingTransform(targetId, { min: v })}
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
          onValueChange={([v]) => updateMappingTransform(targetId, { max: v })}
          step={0.01}
          value={[transform.max]}
        />
      </div>

      {/* Curve */}
      <div className="space-y-0.5">
        <span className="text-muted-foreground text-xs">Curve</span>
        <Select
          onValueChange={(v) =>
            updateMappingTransform(targetId, {
              curve: v as MidiTransform["curve"],
            })
          }
          value={transform.curve}
        >
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
        onClick={() =>
          updateMappingTransform(targetId, { ...DEFAULT_TRANSFORM })
        }
        type="button"
      >
        Reset Transform
      </button>
    </div>
  );
}
