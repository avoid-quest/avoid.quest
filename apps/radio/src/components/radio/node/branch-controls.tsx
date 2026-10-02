/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Toggle } from "@avoid.quest/ui/components/toggle";
import { paramFormatters } from "@/components/audio/effect-params/param-definitions";
import { type BranchParams, setBranchParams } from "@/lib/node-graph/branches";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import { MAX_EDGE_GAIN } from "@/lib/node-graph/schema";
import type { BranchEdgeData } from "./flow-elements";
import { keepControlKeys, ModuleKnob, useReleaseStep } from "./module-frame";

/**
 * Branch Controls
 *
 * A branch's gain, pan, mute and solo, as its cable's tag on the canvas and
 * the inspector's branch list show them. Kept apart from the branch edge so
 * the inspector, which loads without React Flow, can use them.
 */

/** The pan the branch plays at: its chain's, plus its cable's. */
export function branchPan(data: Pick<BranchEdgeData, "basePan" | "pan">) {
  return Math.min(1, Math.max(-1, data.basePan + data.pan));
}

/** Base + cable trim, then what differs from a centred, unmuted branch. */
export function branchSummary(data: BranchEdgeData): string[] {
  const parts: string[] = [];
  const gain = data.baseGain * data.gain;
  if (gain !== 1) {
    parts.push(paramFormatters.linearGain(gain));
  }
  const pan = branchPan(data);
  if (Math.abs(pan) >= 0.05) {
    parts.push(paramFormatters.pan(pan));
  }
  if (data.muted) {
    parts.push("M");
  }
  if (data.solo) {
    parts.push("S");
  }
  return parts;
}

/**
 * Gain and pan knobs, then Mute and Solo. A knob turn folds into the next
 * undo step and its release takes it; a toggle is a step of its own.
 */
export function BranchControls({
  edgeId,
  data,
  store = nodeStore,
}: {
  edgeId: string;
  data: Omit<BranchEdgeData, "tag">;
  store?: NodeStore;
}) {
  const commit = (patch: BranchParams, step: boolean) => {
    commitNodeGraph(
      (graph) => setBranchParams(graph, edgeId, patch),
      store,
      step ? "snapshot" : undefined
    );
  };
  const release = useReleaseStep(() => snapshotNodeGraph(store));
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs tabular-nums">
        Base {paramFormatters.linearGain(data.baseGain)} · base + trim{" "}
        {paramFormatters.linearGain(data.baseGain * data.gain)}
      </p>
      {data.basePan === 0 ? null : (
        <p className="text-muted-foreground text-xs tabular-nums">
          Pan base {paramFormatters.pan(data.basePan)} · base + cable{" "}
          {paramFormatters.pan(branchPan(data))}
        </p>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
      <div
        className="nodrag nopan nowheel flex items-start gap-x-2"
        onKeyDown={keepControlKeys}
        {...release}
      >
        <ModuleKnob
          defaultValue={1}
          description="Cable trim, added to the configured branch base level"
          format={paramFormatters.linearGain}
          label="Cable trim"
          max={MAX_EDGE_GAIN}
          min={0}
          name={`${data.name} cable trim`}
          onChange={(gain) => commit({ gain }, false)}
          value={data.gain}
        />
        <ModuleKnob
          bipolar
          defaultValue={0}
          description="Cable pan, added to the configured branch base pan"
          format={paramFormatters.pan}
          label="Pan"
          max={1}
          min={-1}
          name={`${data.name} pan`}
          onChange={(pan) => commit({ pan }, false)}
          value={data.pan}
        />
        <div className="flex flex-col gap-1 pt-3">
          <Toggle
            aria-label={`Mute ${data.name}`}
            className="h-6 min-w-12 px-2 text-xs"
            onPressedChange={(muted) => commit({ muted }, true)}
            pressed={data.muted}
            size="sm"
            variant="outline"
          >
            Mute
          </Toggle>
          <Toggle
            aria-label={`Solo ${data.name}`}
            className="h-6 min-w-12 px-2 text-xs"
            onPressedChange={(solo) => commit({ solo }, true)}
            pressed={data.solo}
            size="sm"
            variant="outline"
          >
            Solo
          </Toggle>
        </div>
      </div>
    </div>
  );
}
