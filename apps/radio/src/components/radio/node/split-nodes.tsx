/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { useStore } from "@tanstack/react-store";
import { paramFormatters } from "@/components/audio/effect-params/param-definitions";
import { UniversalParams } from "@/components/audio/effect-params/universal-params";
import type { EffectConfig, FrequencySplitConfig } from "@/lib/audio";
import { nodeMidiTargetPrefix } from "@/lib/midi/node-midi-actions";
import {
  BAND_COUNTS,
  type BandCount,
  bandCountOf,
  branchBaseGain,
  branchBasePan,
  branchCables,
  branchName,
  DEFAULT_CROSSOVERS,
  MAX_CROSSOVER_HZ,
  MIN_CROSSOVER_HZ,
  type SplitNode as SplitGraphNode,
  setBandCount,
  setCrossover,
  splitPortIds,
} from "@/lib/node-graph/branches";
import { getNodeDefinition, portHandleId } from "@/lib/node-graph/catalogue";
import { nodeLabel } from "@/lib/node-graph/describe";
import { setEffectParams } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import { nodeBackendBadges } from "@/lib/node-playback";
import { BranchControls } from "./branch-controls";
import type { EffectFlowNode } from "./effect-node";
import { EffectNodeBody } from "./effect-node";
import type { FlowNodeProps } from "./flow-adapter";
import {
  controlName,
  ModuleKnob,
  ModulePorts,
  ModuleSelect,
} from "./module-frame";
import { useNodeActions } from "./node-actions";

/**
 * Split Nodes
 *
 * Split, Stereo Split and Band Split: one input, a port per branch. A Split
 * grows a port as each branch is cabled (two to four), a Stereo Split has
 * left and right, and a Band Split one port per band, low to high. The
 * branch cables carry each branch's gain, pan, mute and solo; the compiler
 * lowers the split and the Merge that closes it into one container in the
 * lane. A Band Split's body is its band count and crossovers.
 */

type BandSplitNode = SplitGraphNode & { type: "frequencySplit" };

const BAND_OPTIONS = BAND_COUNTS.map((count) => ({
  label: `${count} bands`,
  short: String(count),
  value: String(count),
}));

/** A Band Split's controls: how many bands, and a knob per crossover. */
export function BandControls({
  node,
  store = nodeStore,
}: {
  node: BandSplitNode;
  store?: NodeStore;
}) {
  const effect = node.data.effect as FrequencySplitConfig;
  const title = getNodeDefinition(node.type).name;
  return (
    <>
      <ModuleSelect
        label="Bands"
        name={controlName(title, "Bands")}
        onChange={(value) => {
          commitNodeGraph(
            (graph) =>
              setBandCount(
                graph,
                node.id,
                Number.parseInt(value, 10) as BandCount
              ),
            store,
            "snapshot"
          );
        }}
        options={BAND_OPTIONS}
        value={String(bandCountOf(effect))}
      />
      {effect.crossoverFrequencies.map((frequency, index) => {
        const label = `Crossover ${index + 1}`;
        return (
          <ModuleKnob
            defaultValue={DEFAULT_CROSSOVERS[bandCountOf(effect)][index]}
            description="Where one band hands over to the next"
            format={paramFormatters.frequency}
            // Bands are positional, so a crossover's knob is too.
            // biome-ignore lint/suspicious/noArrayIndexKey: one knob per crossover slot
            key={index}
            label={label}
            max={MAX_CROSSOVER_HZ}
            min={MIN_CROSSOVER_HZ}
            name={controlName(title, label)}
            onChange={(value) => {
              commitNodeGraph(
                (graph) => setCrossover(graph, node.id, index, value),
                store
              );
            }}
            scale="log"
            step={1}
            value={frequency}
          />
        );
      })}
    </>
  );
}

/** The out ports this split shows, as a string so the node re-renders only when they change. */
function usePortIds(node: SplitGraphNode): string[] {
  const key = useStore(nodeStore, (state) =>
    splitPortIds(node, state.graph?.edges ?? []).join(" ")
  );
  return key.split(" ");
}

/** A split on the canvas: an effect body with its branch ports. */
export function SplitNode({
  id,
  type,
  data,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
}: FlowNodeProps<EffectFlowNode>) {
  const actions = useNodeActions();
  const badge = useStore(nodeBackendBadges, (state) => state[id] ?? null);
  const node = {
    data,
    id,
    position: { x: positionAbsoluteX, y: positionAbsoluteY },
    type,
  } as SplitGraphNode;
  const outputs = usePortIds(node);
  const commit = (patch: Partial<EffectConfig>, step: boolean) => {
    commitNodeGraph(
      (graph) => setEffectParams(graph, id, patch),
      nodeStore,
      step ? "snapshot" : undefined
    );
  };
  const bands =
    node.type === "frequencySplit"
      ? {
          columns:
            1 +
            (data.effect as FrequencySplitConfig).crossoverFrequencies.length,
          node: <BandControls node={node as BandSplitNode} />,
        }
      : undefined;
  return (
    <>
      <EffectNodeBody
        badge={badge}
        controls={bands}
        effect={data.effect}
        onChange={(patch) => commit(patch, false)}
        onInspect={() => actions.inspectNode(id)}
        onRelease={() => snapshotNodeGraph()}
        onRemove={() => actions.removeNode(id)}
        onStep={(patch) => commit(patch, true)}
        selected={selected}
      />
      <ModulePorts
        nodeId={id}
        outputIds={outputs}
        outputLabel={(port) => branchName(node, portHandleId(port))}
        title={getNodeDefinition(type).name}
        type={type}
      />
    </>
  );
}

/**
 * Every setting of a split, for the inspector: its mix row, its bands, and
 * each branch cable's gain, pan, mute and solo. Branches live on cables, so
 * there is no nested effect to add here; patch one onto a branch instead.
 */
export function SplitInspectorParams({
  node,
  store = nodeStore,
}: {
  node: SplitGraphNode;
  store?: NodeStore;
}) {
  const graph = useStore(store, (state) => state.graph);
  const effect = node.data.effect as EffectConfig;
  const cables = graph ? branchCables(graph, node.id) : [];
  const nodes = new Map(graph?.nodes.map((entry) => [entry.id, entry]));
  return (
    <div className="space-y-4">
      <UniversalParams
        effect={effect}
        midiTargetPrefix={nodeMidiTargetPrefix(node.id)}
        onUpdate={(patch) => {
          commitNodeGraph(
            (latest) => setEffectParams(latest, node.id, patch),
            store
          );
        }}
      />
      {node.type === "frequencySplit" ? (
        <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
          <BandControls node={node as BandSplitNode} store={store} />
        </div>
      ) : null}
      <section aria-label="Branches" className="space-y-2">
        <h3 className="font-medium text-xs">Branches</h3>
        {cables.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Cable a port to start a branch.
          </p>
        ) : (
          <ul className="space-y-2">
            {cables.map((edge) => {
              const name = branchName(node, edge.sourceHandle);
              return (
                <li
                  className="space-y-1.5 rounded-md border border-border/50 p-2"
                  key={edge.id}
                >
                  <p className="truncate text-xs">
                    {name}
                    <span className="text-muted-foreground">
                      {" "}
                      to {nodeLabel(nodes.get(edge.target))}
                    </span>
                  </p>
                  <BranchControls
                    data={{
                      baseGain: branchBaseGain(node, edge.sourceHandle),
                      basePan: branchBasePan(node, edge.sourceHandle),
                      gain: edge.gain,
                      muted: edge.muted,
                      name,
                      pan: edge.pan ?? 0,
                      solo: edge.solo === true,
                    }}
                    edgeId={edge.id}
                    store={store}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
