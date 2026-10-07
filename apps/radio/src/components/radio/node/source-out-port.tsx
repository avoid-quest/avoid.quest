import { cn } from "@avoid.quest/ui/lib/utils";
import { findPort } from "@/lib/node-graph/catalogue";
import type { RadioSourceNodeType } from "@/lib/node-graph/schema";
import { Position } from "./flow-adapter";
import { NodePort } from "./module-frame";

/** Audio out lights with playback; Parameter accepts source pan/trim modulation. */
export function SourceOutPort({
  type,
  name,
  isLive,
}: {
  type: RadioSourceNodeType | "deviceIn";
  /** What it holds, or its type while empty. */
  name: string;
  isLive: boolean;
}) {
  const port = findPort(type, "out", "audio", "main");
  const parameter = findPort(type, "in", "control", "parameter");
  return (
    <>
      {parameter ? (
        <NodePort
          ariaLabel={`${name} parameter input`}
          label="Parameter input"
          port={parameter}
          position={Position.Left}
          type={type}
        />
      ) : null}
      {port ? (
        <NodePort
          ariaLabel={`${name} audio out`}
          className={cn(isLive && "node-port-live")}
          label="Audio out"
          port={port}
          position={Position.Right}
          type={type}
        />
      ) : null}
    </>
  );
}
