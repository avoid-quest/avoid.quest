import { cn } from "@avoid.quest/ui/lib/utils";
import type { ReactNode } from "react";
import { portHandleId } from "@/lib/node-graph/catalogue";
import { portKey } from "@/lib/node-graph/palette";
import { usePortHint } from "./connection-hints";
import {
  Handle,
  Position,
  useConnection,
  useFlowStore,
  useNodeConnections,
  useNodeId,
  useUpdateNodeInternals,
} from "./flow-adapter";
import {
  type FlowPorts,
  FlowPortsProvider,
  type NodePortProps,
  nodePortState,
} from "./module-frame";

/**
 * Canvas Port
 *
 * `NodePort` as the canvas draws it, in the React Flow chunk: its cables
 * come from `useNodeConnections`, and the drag from `useConnection` (or
 * the first tap of a tap-then-tap), read only for where it started, so a
 * pointer move re-renders no port. The drag's verdicts come from
 * `connectionHints`, taken once when it started.
 */
export function CanvasPort({
  type,
  port,
  label,
  ariaLabel,
  position,
  style,
  className,
}: NodePortProps) {
  const handle = portHandleId(port);
  const handleType = port.direction === "in" ? "target" : "source";
  const nodeId = useNodeId() ?? "";
  const cables = useNodeConnections({ handleId: handle, handleType });
  const dragFrom = useConnection((connection) =>
    connection.inProgress
      ? portKey(connection.fromNode.id, connection.fromHandle.id ?? "")
      : null
  );
  // Tap-then-tap (connectOnClick) keeps its first port outside the
  // connection state.
  const tapFrom = useFlowStore(({ connectionClickStartHandle: tapped }) =>
    tapped ? portKey(tapped.nodeId, tapped.id ?? "") : null
  );
  const hint = usePortHint(dragFrom ?? tapFrom, portKey(nodeId, handle));
  const state = nodePortState({
    cables: cables.length,
    hint,
    label,
    port,
    type,
  });
  return (
    <Handle
      aria-label={ariaLabel}
      className={cn("node-port", state.className, className)}
      data-kind={port.kind}
      id={handle}
      isConnectableEnd={state.isConnectableEnd}
      isConnectableStart={state.isConnectableStart}
      position={position}
      style={style}
      title={state.title}
      type={handleType}
    />
  );
}

/** What node ports draw with; only the canvas chunk loads React Flow. */
export function FlowPortsRoot({ children }: { children: ReactNode }) {
  const updateNodeInternals = useUpdateNodeInternals();
  const ports: FlowPorts = { Port: CanvasPort, Position, updateNodeInternals };
  return <FlowPortsProvider value={ports}>{children}</FlowPortsProvider>;
}
