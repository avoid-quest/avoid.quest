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
  controlDepth,
  type ModulationParameter,
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
  const edge = useStore(store, (state) =>
    state.graph?.edges.find((entry) => entry.id === edgeId)
  );
  const parameters = useStore(
    store,
    (state) => {
      const target = state.graph?.nodes.find(
        (entry) => entry.id === edge?.target
      );
      if (!target) {
        return null;
      }
      return edge?.targetHandle === "in:control:parameter"
        ? modulationParameters(target)
        : [];
    },
    sameParameters
  );
  const occupied = useStore(
    store,
    (state) =>
      state.graph?.edges
        .filter(
          (entry) =>
            entry.id !== edgeId &&
            entry.source === edge?.source &&
            entry.sourceHandle === edge?.sourceHandle &&
            entry.target === edge?.target &&
            entry.targetHandle === edge?.targetHandle
        )
        .map((entry) => entry.parameter ?? "") ?? [],
    sameEntries
  );
  const release = useReleaseStep(() => snapshotNodeGraph(store));
  if (!(edge && parameters)) {
    return null;
  }
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
                  disabled={
                    occupied.includes(parameter.key) ||
                    (parameter.key === parameters[0]?.key &&
                      occupied.includes(""))
                  }
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
      <p className="max-w-56 text-muted-foreground text-xs">
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
  const edges = useStore<NodeStore["state"], GraphEdge[]>(
    store,
    (state) =>
      state.graph?.edges.filter(
        (edge) =>
          (edge.target === nodeId || edge.source === nodeId) &&
          edge.targetHandle.startsWith("in:control:")
      ) ?? [],
    sameEntries
  );
  if (edges.length === 0) {
    return null;
  }
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      <p className="font-medium text-xs">Modulation cables</p>
      {edges.map((edge) => (
        <div className="space-y-2 rounded border p-2" key={edge.id}>
          <AssignmentName edge={edge} store={store} />
          <ModulationCableControls edgeId={edge.id} store={store} />
        </div>
      ))}
    </div>
  );
}

function sameEntries<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function AssignmentName({
  edge,
  store,
}: {
  edge: GraphEdge;
  store: NodeStore;
}) {
  const name = useStore(store, (state) => {
    const source = state.graph?.nodes.find((node) => node.id === edge.source);
    const target = state.graph?.nodes.find((node) => node.id === edge.target);
    return `${source ? getNodeDefinition(source.type).name : "Source"} → ${target ? getNodeDefinition(target.type).name : "Target"}`;
  });
  return <p className="text-xs">{name}</p>;
}

function sameParameters(
  a: ModulationParameter[] | null,
  b: ModulationParameter[] | null
): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.length === b.length &&
      a.every((entry, index) => {
        const other = b[index];
        return (
          other !== undefined &&
          entry.key === other.key &&
          entry.label === other.label &&
          entry.min === other.min &&
          entry.max === other.max &&
          entry.step === other.step &&
          entry.scale === other.scale
        );
      }))
  );
}
