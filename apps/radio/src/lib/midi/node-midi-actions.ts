/**
 * Node MIDI Actions
 *
 * Every node param in the patch as a MIDI action, addressed
 * `node:<nodeId>:<paramKey>` (and `node:<nodeId>:chain:<chainId>:<key>` for
 * a split's branches). Each node's actions form one group named after its
 * title, so they list in MIDI settings. A dispatch is a graph commit, the
 * same as a knob turn, so node playback applies it and undo covers it.
 */

import { ValueMapping } from "@opendaw/lib-std";
import { scaleMapping, sliderScale } from "@/lib/audio/dsp/effects/param-scale";
import { getEffectMidiParamDefs } from "@/lib/audio/dsp/effects/schema";
import type { EffectConfig } from "@/lib/audio/dsp/effects/types";
import { isEffectContainer } from "@/lib/audio/dsp/routing/effect-tree";
import {
  getNodeDefinition,
  isEffectNodeType,
} from "@/lib/node-graph/catalogue";
import {
  type NativeParams,
  setEffectParams,
  setNativeParams,
} from "@/lib/node-graph/graph-edits";
import { modulationFields } from "@/lib/node-graph/modulation-fields";
import {
  NATIVE_PARAM_RANGES,
  setModulatorParams,
} from "@/lib/node-graph/modulation-parameters";
import { isModulationType } from "@/lib/node-graph/modulation-schema";
import {
  commitNodeGraph,
  type NodeCommitHistory,
} from "@/lib/node-graph/node-store";
import {
  type GraphNode,
  isModulationNode,
  type NodeGraph,
} from "@/lib/node-graph/schema";
import { NODE_TARGET_PREFIX } from "./midi-control";
import type { MidiAction, MidiTargetId } from "./types";

/** Applies an edit to the patch; the default commits to the node store. */
export type NodeMidiCommit = (
  update: (graph: NodeGraph) => NodeGraph,
  history?: NodeCommitHistory
) => void;

type NativeNodeType = "filter" | "pan" | "gain";

const CHAIN_PARAMS = [
  ["gain", "gain", 0, 4, 0.01],
  ["pan", "pan", -1, 1, 0.01],
] as const;

/** `node:<nodeId>`, the prefix every target on the node starts with. */
export function nodeMidiTargetPrefix(nodeId: string): MidiTargetId {
  return `${NODE_TARGET_PREFIX}${nodeId}`;
}

function isNativeNode(
  node: GraphNode
): node is Extract<GraphNode, { type: NativeNodeType }> {
  return node.type === "filter" || node.type === "pan" || node.type === "gain";
}

function effectActions(
  nodeId: string,
  effect: EffectConfig,
  group: string,
  commit: NodeMidiCommit
): MidiAction[] {
  const prefix = nodeMidiTargetPrefix(nodeId);
  const actions: MidiAction[] = [
    {
      dispatch: () =>
        commit((graph) => {
          const node = graph.nodes.find((entry) => entry.id === nodeId);
          const current = (node?.data as { effect?: EffectConfig } | undefined)
            ?.effect;
          return current
            ? setEffectParams(graph, nodeId, { enabled: !current.enabled })
            : graph;
        }, "snapshot"),
      group,
      label: "Enabled",
      targetId: `${prefix}:enabled`,
      type: "button",
    },
  ];
  for (const param of getEffectMidiParamDefs(effect.type)) {
    // A mapping's transform can reach past 0..1, and the patch refuses an FX
    // param its control can't set: the mapping keeps it in range.
    const mapping = scaleMapping(param.min, param.max, sliderScale(param));
    actions.push({
      dispatch: (value) =>
        commit((graph) =>
          setEffectParams(graph, nodeId, {
            [param.key]: mapping.y(value),
          } as Partial<EffectConfig>)
        ),
      group,
      label: param.label,
      range: { max: param.max, min: param.min, step: param.step },
      targetId: `${prefix}:${param.key}`,
      type: "continuous",
    });
  }
  if (!isEffectContainer(effect)) {
    return actions;
  }
  for (const chain of effect.chains) {
    for (const [key, label, min, max, step] of CHAIN_PARAMS) {
      const mapping = ValueMapping.linear(min, max);
      actions.push({
        dispatch: (value) =>
          commit((graph) => {
            const node = graph.nodes.find((entry) => entry.id === nodeId);
            const current = (
              node?.data as { effect?: EffectConfig } | undefined
            )?.effect;
            if (!(current && isEffectContainer(current))) {
              return graph;
            }
            return setEffectParams(graph, nodeId, {
              chains: current.chains.map((entry) =>
                entry.id === chain.id
                  ? { ...entry, [key]: mapping.y(value) }
                  : entry
              ),
            } as Partial<EffectConfig>);
          }),
        group,
        label: `${chain.name || "Branch"} ${label}`,
        range: { max, min, step },
        targetId: `${prefix}:chain:${chain.id}:${key}`,
        type: "continuous",
      });
    }
  }
  return actions;
}

function nativeActions(
  node: Extract<GraphNode, { type: NativeNodeType }>,
  group: string,
  commit: NodeMidiCommit
): MidiAction[] {
  const prefix = nodeMidiTargetPrefix(node.id);
  return NATIVE_PARAM_RANGES[node.type].map((range) => {
    const mapping = scaleMapping(range.min, range.max, range.scale);
    return {
      dispatch: (value: number) =>
        commit((graph) =>
          setNativeParams(graph, node.id, {
            [range.key]: mapping.y(value),
          } as NativeParams)
        ),
      group,
      label: range.label,
      range: { max: range.max, min: range.min, step: range.step },
      targetId: `${prefix}:${range.key}`,
      type: "continuous" as const,
    };
  });
}

/**
 * The MIDI group for each node with params: its title, numbered when the
 * patch has more than one ("Compressor", "Compressor 2").
 */
export function nodeMidiGroups(graph: NodeGraph): Map<string, string> {
  const groups = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const node of graph.nodes) {
    if (
      !(
        isEffectNodeType(node.type) ||
        isNativeNode(node) ||
        isModulationType(node.type)
      )
    ) {
      continue;
    }
    const title = getNodeDefinition(node.type).name;
    const count = (seen.get(title) ?? 0) + 1;
    seen.set(title, count);
    groups.set(node.id, count === 1 ? title : `${title} ${count}`);
  }
  return groups;
}

/**
 * What the actions depend on: nodes with params, their groups and a split's
 * branches and envelope stage counts. Knob turns leave it alone, so MIDI
 * settings and every learn badge re-render only when the patch's shape changes.
 */
export function nodeMidiSignature(graph: NodeGraph): string {
  const groups = nodeMidiGroups(graph);
  return graph.nodes
    .flatMap((node) => {
      const group = groups.get(node.id);
      if (!group) {
        return [];
      }
      const { effect } = node.data as { effect?: EffectConfig };
      const chains =
        effect && isEffectContainer(effect)
          ? effect.chains.map((chain) => `${chain.id}=${chain.name}`)
          : [];
      return [
        [
          node.id,
          node.type,
          group,
          ...chains,
          ...(node.type === "multiEnvelope" ? [node.data.points.length] : []),
        ].join("\t"),
      ];
    })
    .join("\n");
}

const commitToNodeStore: NodeMidiCommit = (update, history) => {
  commitNodeGraph(update, undefined, history);
};

/**
 * Every FX and native strip param in `graph` as a MIDI action. A continuous
 * move folds into the next undo step, like a knob turn; toggling an effect
 * is a step of its own.
 */
export function createNodeMidiActions(
  graph: NodeGraph,
  commit: NodeMidiCommit = commitToNodeStore
): MidiAction[] {
  const groups = nodeMidiGroups(graph);
  return graph.nodes.flatMap((node) => {
    const group = groups.get(node.id);
    if (!group) {
      return [];
    }
    if (isNativeNode(node)) {
      return nativeActions(node, group, commit);
    }
    if (isModulationNode(node)) {
      return modulationFields(node).flatMap((field): MidiAction[] => {
        if (field.kind !== "number") {
          return [];
        }
        return [
          {
            dispatch: (value) =>
              commit((current) => {
                const next = scaleMapping(field.min, field.max, field.scale).y(
                  value
                );
                return setModulatorParams(current, node.id, {
                  [field.key]: Math.round(next / field.step) * field.step,
                });
              }),
            group,
            label: field.label,
            range: { max: field.max, min: field.min, step: field.step },
            targetId: `${nodeMidiTargetPrefix(node.id)}:${field.key}`,
            type: "continuous",
          },
        ];
      });
    }
    const { effect } = node.data as { effect: EffectConfig };
    return effectActions(node.id, effect, group, commit);
  });
}
