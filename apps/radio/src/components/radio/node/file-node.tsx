import type { GraphNode } from "@/lib/node-graph/schema";
import { FileNodeContent } from "./file-content";
import type { FlowNode, FlowNodeProps } from "./flow-adapter";
import { useSourceLane } from "./source-node-frame";
import { SourceOutPort } from "./source-out-port";

export { FileNodeBody } from "./file-content";

export type FileFlowNode = FlowNode<
  Extract<GraphNode, { type: "file" }>["data"],
  "file"
>;

/** The canvas adds the source's audio port to its shared controls. */
export function FileNode(props: FlowNodeProps<FileFlowNode>) {
  const lane = useSourceLane(props.id);
  return (
    <>
      <FileNodeContent {...props} />
      <SourceOutPort
        isLive={lane.isPlaying && !lane.isLoading}
        name={props.data.radio?.name ?? "File"}
        type="file"
      />
    </>
  );
}
