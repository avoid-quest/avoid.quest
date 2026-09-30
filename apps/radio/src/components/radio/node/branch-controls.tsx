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
import { keepControlKeys, ModuleKnob, RELEASE_DELAY_MS } from "./module-frame";

/**
 * Branch Controls
 *
 * A branch's gain, pan, mute and solo, as its cable's tag on the canvas and
 * the inspector's branch list show them. Kept apart from the branch edge so
 * the inspector, which loads without React Flow, can use them.
 */

/** "−6.0 dB · L40 · M · S": what differs from a unity, centred branch. */
export function branchSummary(data: BranchEdgeData): string[] {
  const parts: string[] = [];
  if (data.gain !== 1) {
    parts.push(paramFormatters.linearGain(data.gain));
  }
  if (Math.abs(data.pan) >= 0.05) {
    parts.push(paramFormatters.pan(data.pan));
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
  data: Pick<BranchEdgeData, "name" | "gain" | "pan" | "muted" | "solo">;
  store?: NodeStore;
}) {
  const commit = (patch: BranchParams, step: boolean) => {
    commitNodeGraph(
      (graph) => setBranchParams(graph, edgeId, patch),
      store,
      step ? "snapshot" : undefined
    );
  };
  const release = () => {
    setTimeout(() => snapshotNodeGraph(store), RELEASE_DELAY_MS);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself
    <div
      className="nodrag nopan nowheel flex items-start gap-x-2"
      onKeyDown={keepControlKeys}
      onKeyUp={release}
      onPointerUp={release}
    >
      <ModuleKnob
        defaultValue={1}
        format={paramFormatters.linearGain}
        label="Gain"
        max={MAX_EDGE_GAIN}
        min={0}
        name={`${data.name} gain`}
        onChange={(gain) => commit({ gain }, false)}
        value={data.gain}
      />
      <ModuleKnob
        bipolar
        defaultValue={0}
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
  );
}
