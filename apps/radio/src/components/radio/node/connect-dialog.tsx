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
import { nodeLabel } from "@/lib/node-graph/describe";
import { connectNodes } from "@/lib/node-graph/graph-edits";
import {
  commitNodeGraph,
  type NodeStore,
  nodeStore,
  useNodeGraph,
} from "@/lib/node-graph/node-store";
import { connectPorts } from "@/lib/node-graph/palette";
import type { ValidateOptions } from "@/lib/node-graph/validate";
import { EmptyHint } from "../empty-hint";

type ConnectDialogProps = {
  /** The focused node the dialog connects from; null while closed. */
  nodeId: string | null;
  onClose: () => void;
  validateOptions?: ValidateOptions;
  store?: NodeStore;
};

/**
 * Keyboard connecting, which React Flow lacks: pick one of this node's
 * ports, then a port elsewhere its cable can reach. Both lists hold only
 * what `validateConnection` accepts, so every choice connects.
 */
export function ConnectDialog({
  nodeId,
  onClose,
  validateOptions,
  store = nodeStore,
}: ConnectDialogProps) {
  const graph = useNodeGraph(store);
  const [portHandle, setPortHandle] = useState<string | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const node = graph?.nodes.find((entry) => entry.id === nodeId);
  const ports =
    graph && node ? connectPorts(graph, node.id, validateOptions) : [];
  // The first port is chosen until another is; a stale pick falls back too.
  const port =
    ports.find((entry) => entry.handle === portHandle) ?? ports[0] ?? null;
  const target =
    port?.targets.find((entry) => entry.key === targetKey) ??
    (port?.targets.length === 1 ? port.targets[0] : undefined);
  const name = nodeLabel(node);

  const close = () => {
    setPortHandle(null);
    setTargetKey(null);
    onClose();
  };
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      close();
    }
  };
  const handlePortChange = (handle: string) => {
    setPortHandle(handle);
    setTargetKey(null);
  };
  const handleConnect = (event: React.FormEvent) => {
    event.preventDefault();
    if (!target) {
      return;
    }
    commitNodeGraph(
      (current) => connectNodes(current, target.connection),
      store,
      "snapshot"
    );
    close();
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={Boolean(node)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {name}</DialogTitle>
          <DialogDescription>
            Pick one of its ports, then where the cable goes.
          </DialogDescription>
        </DialogHeader>
        {port ? (
          <form className="space-y-4" onSubmit={handleConnect}>
            <div className="grid gap-2">
              <Label className="text-xs" htmlFor="node-connect-port">
                Port
              </Label>
              <Select onValueChange={handlePortChange} value={port.handle}>
                <SelectTrigger
                  aria-label={`${name} port`}
                  className="w-full"
                  id="node-connect-port"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ports.map((entry) => (
                    <SelectItem key={entry.handle} value={entry.handle}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs" htmlFor="node-connect-target">
                Connect to
              </Label>
              <Select onValueChange={setTargetKey} value={target?.key ?? ""}>
                <SelectTrigger
                  aria-label="Connect to"
                  className="w-full"
                  id="node-connect-target"
                  size="sm"
                >
                  <SelectValue placeholder="Choose a port" />
                </SelectTrigger>
                <SelectContent>
                  {port.targets.map((entry) => (
                    <SelectItem key={entry.key} value={entry.key}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button onClick={close} size="sm" type="button" variant="ghost">
                Cancel
              </Button>
              <Button disabled={!target} size="sm" type="submit">
                Connect
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <EmptyHint>Nothing can take a new cable from {name}.</EmptyHint>
        )}
      </DialogContent>
    </Dialog>
  );
}
