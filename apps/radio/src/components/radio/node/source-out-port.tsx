import { cn } from "@avoid.quest/ui/lib/utils";
import { findPort } from "@/lib/node-graph/catalogue";
import type { RadioSourceNodeType } from "@/lib/node-graph/schema";
import { Position } from "./flow-adapter";
import { NodePort } from "./module-frame";

/** A source's one port, audio out, lit while its lane plays. */
export function SourceOutPort({
  type,
  name,
  isLive,
}: {
  type: RadioSourceNodeType;
  /** What it holds, or its type while empty. */
  name: string;
  isLive: boolean;
}) {
  const port = findPort(type, "out", "audio", "main");
  return port ? (
    <NodePort
      ariaLabel={`${name} audio out`}
      className={cn(isLive && "node-port-live")}
      label="Audio out"
      port={port}
      position={Position.Right}
      type={type}
    />
  ) : null;
}
