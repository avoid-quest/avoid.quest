/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import { Label } from "@avoid.quest/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { useState } from "react";
import { edgeLabel } from "@/lib/node-graph/describe";
import { reconnectEdge } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  useNodeGraph,
} from "@/lib/node-graph/node-store";
import { rewireTargets } from "@/lib/node-graph/palette";
import type { ValidateOptions } from "@/lib/node-graph/validate";

/** A cable can be rewired with taps or a keyboard, without dragging its ends. */
export function RewireDialog({
  edgeId,
  onClose,
  validateOptions,
  store = nodeStore,
}: {
  edgeId: string;
  onClose: () => void;
  validateOptions?: ValidateOptions;
  store?: NodeStore;
}) {
  const graph = useNodeGraph(store);
  const edge = graph?.edges.find((entry) => entry.id === edgeId);
  const [end, setEnd] = useState<"source" | "target">("target");
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const currentKey = edge ? `${edge[end]} ${edge[`${end}Handle`]}` : "";
  const targets = graph
    ? rewireTargets(graph, edgeId, end, validateOptions)
    : [];
  const target = targets.find(
    (entry) => entry.key === (targetKey ?? currentKey)
  );
  const handleRewire = (event: React.FormEvent) => {
    event.preventDefault();
    const current = store.state.graph;
    if (!(current && target) || target.reason !== null) {
      return;
    }
    const edit = reconnectEdge(
      current,
      edgeId,
      target.connection,
      validateOptions
    );
    if (!edit.ok) {
      setRefusal(edit.message);
      return;
    }
    commitNodeGraph(() => edit.graph, store, "snapshot");
    onClose();
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={Boolean(edge)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rewire cable</DialogTitle>
          <DialogDescription>
            {graph && edge ? edgeLabel(graph, edge) : "That cable is gone"}.
            Pick which end to move, then its new port.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleRewire}>
          <div className="grid gap-2">
            <Label htmlFor="node-rewire-end">Cable end</Label>
            <Select
              onValueChange={(value) => {
                if (value === "source" || value === "target") {
                  setEnd(value);
                  setTargetKey(null);
                  setRefusal(null);
                }
              }}
              value={end}
            >
              <SelectTrigger
                aria-label="Cable end"
                className="w-full"
                id="node-rewire-end"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="source">Source</SelectItem>
                <SelectItem value="target">Destination</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="node-rewire-port">New port</Label>
            <Select
              onValueChange={(value) => {
                setTargetKey(value);
                setRefusal(null);
              }}
              value={target?.key ?? ""}
            >
              <SelectTrigger
                aria-label="New port"
                className="w-full"
                id="node-rewire-port"
              >
                <SelectValue placeholder="Choose a port" />
              </SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-2rem)]">
                {targets.map((entry) => (
                  <SelectItem
                    disabled={entry.reason !== null}
                    key={entry.key}
                    value={entry.key}
                  >
                    <span className="whitespace-normal">
                      {entry.label}
                      {entry.reason ? ` — ${entry.reason}` : ""}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {refusal ? <p role="alert">{refusal}</p> : null}
          <DialogFooter>
            <Button onClick={onClose} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={
                !target || target.reason !== null || target.key === currentKey
              }
              size="sm"
              type="submit"
            >
              Rewire
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
