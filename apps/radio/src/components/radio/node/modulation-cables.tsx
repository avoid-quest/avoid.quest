/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { useStore } from "@tanstack/react-store";
import { getNodeDefinition } from "@/lib/node-graph/catalogue";
import { modulationParameters } from "@/lib/node-graph/modulation-parameters";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  snapshotNodeGraph,
} from "@/lib/node-graph/node-store";
import type { GraphEdge } from "@/lib/node-graph/schema";
import { ModuleKnob, ModuleSwitch, useReleaseStep } from "./module-frame";

export function ModulationCableControls({
  edgeId,
  store = nodeStore,
}: {
  edgeId: string;
  store?: NodeStore;
}) {
  const graph = useStore(store, (state) => state.graph);
  const edge = graph?.edges.find((entry) => entry.id === edgeId);
  const target = graph?.nodes.find((entry) => entry.id === edge?.target);
  const release = useReleaseStep(() => snapshotNodeGraph(store));
  if (!(edge && target)) {
    return null;
  }
  const parameters =
    edge.targetHandle === "in:control:parameter"
      ? modulationParameters(target)
      : [];
  const selected = edge.parameter ?? parameters[0]?.key;
  const defaultDepth = parameters.length > 0 ? 0.25 : 1;
  const commit = (patch: Partial<GraphEdge>, step = false) =>
    commitNodeGraph(
      (current) => ({
        ...current,
        edges: current.edges.map((entry) =>
          entry.id === edgeId ? { ...entry, ...patch } : entry
        ),
      }),
      store,
      step ? "snapshot" : undefined
    );
  return (
    <div className="space-y-2" {...release}>
      {parameters.length > 0 ? (
        <div className="space-y-1 text-xs">
          <p>Target parameter</p>
          <Select
            onValueChange={(parameter) => commit({ parameter }, true)}
            value={selected}
          >
            <SelectTrigger
              aria-label="Modulation target parameter"
              className="w-full"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {parameters.map((parameter) => (
                <SelectItem key={parameter.key} value={parameter.key}>
                  {parameter.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-xs">
          {edge.targetHandle.endsWith(":gate")
            ? "Gate / reset"
            : "Control input"}
        </p>
      )}
      <div className="flex items-start gap-3">
        <ModuleKnob
          bipolar
          defaultValue={defaultDepth}
          format={(value) => `${Math.round(value * 100)}%`}
          label="Depth"
          max={1}
          min={-1}
          name="Modulation depth"
          onChange={(depth) => commit({ depth })}
          step={0.01}
          value={edge.depth ?? defaultDepth}
        />
        <ModuleSwitch
          checked={!edge.muted}
          label="Enabled"
          name="Modulation cable enabled"
          onChange={(enabled) => commit({ muted: !enabled }, true)}
        />
      </div>
      <p className="max-w-56 text-[10px] text-muted-foreground">
        {parameters.length > 0
          ? "Depth adds a fraction of the parameter range to its saved value."
          : "Depth scales the incoming control signal."}{" "}
        Negative depth reverses it; multiple cables add together.
      </p>
      <Button
        onClick={() =>
          commitNodeGraph(
            (current) => ({
              ...current,
              edges: current.edges.filter((entry) => entry.id !== edgeId),
            }),
            store,
            "snapshot"
          )
        }
        size="sm"
        variant="outline"
      >
        Disconnect
      </Button>
    </div>
  );
}

export function ModulationAssignments({
  nodeId,
  store,
}: {
  nodeId: string;
  store: NodeStore;
}) {
  const graph = useStore(store, (state) => state.graph);
  const edges =
    graph?.edges.filter(
      (edge) =>
        (edge.target === nodeId || edge.source === nodeId) &&
        edge.targetHandle.startsWith("in:control:")
    ) ?? [];
  if (!graph || edges.length === 0) {
    return null;
  }
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      <p className="font-medium text-xs">Modulation cables</p>
      {edges.map((edge) => {
        const source = graph.nodes.find((node) => node.id === edge.source);
        const target = graph.nodes.find((node) => node.id === edge.target);
        return (
          <div className="space-y-2 rounded border p-2" key={edge.id}>
            <p className="text-xs">
              {source ? getNodeDefinition(source.type).name : "Source"} →{" "}
              {target ? getNodeDefinition(target.type).name : "Target"}
            </p>
            <ModulationCableControls edgeId={edge.id} store={store} />
          </div>
        );
      })}
    </div>
  );
}
