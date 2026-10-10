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
import {
  connectionKey,
  controlDepth,
  modulationParameters,
} from "@/lib/node-graph/modulation-parameters";
import { unappliedModulation } from "@/lib/node-graph/modulation-runtime";
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
  const unapplied = useStore(unappliedModulation, (state) => state[edgeId]);
  const graph = useStore(store, (state) => state.graph);
  const edge = graph?.edges.find((entry) => entry.id === edgeId);
  const target = graph?.nodes.find((entry) => entry.id === edge?.target);
  const release = useReleaseStep(() => snapshotNodeGraph(store));
  if (!(graph && edge && target)) {
    return null;
  }
  const parameters =
    edge.targetHandle === "in:control:parameter"
      ? modulationParameters(target)
      : [];
  const selected = edge.parameter ?? parameters[0]?.key;
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
      {unapplied ? (
        <p className="max-w-56 text-muted-foreground text-xs">
          <span className="font-medium text-foreground">
            {unapplied.partly ? "Partly applied." : "Not applied."}
          </span>{" "}
          {unapplied.why}.
        </p>
      ) : null}
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
                <SelectItem
                  disabled={graph.edges.some(
                    (entry) =>
                      entry.id !== edgeId &&
                      connectionKey(graph, entry) ===
                        connectionKey(graph, {
                          ...edge,
                          parameter: parameter.key,
                        })
                  )}
                  key={parameter.key}
                  value={parameter.key}
                >
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
          defaultValue={controlDepth({ ...edge, depth: undefined })}
          format={(value) => `${Math.round(value * 100)}%`}
          label="Depth"
          max={1}
          min={-1}
          name="Modulation depth"
          onChange={(depth) => commit({ depth })}
          step={0.01}
          value={controlDepth(edge)}
        />
        <ModuleSwitch
          checked={!edge.muted}
          label="Enabled"
          name="Modulation cable enabled"
          onChange={(enabled) => commit({ muted: !enabled }, true)}
        />
      </div>
      <p className="max-w-56 text-[10px] text-muted-foreground">
        Depth adds a fraction of the parameter range to its saved value.
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
