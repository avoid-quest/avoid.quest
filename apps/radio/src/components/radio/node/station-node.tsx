import type { GraphNode } from "@/lib/node-graph/schema";
import type { FlowNode, FlowNodeProps } from "./flow-adapter";
import { useSourceLane } from "./source-node-frame";
import { SourceOutPort } from "./source-out-port";
import { StationNodeContent } from "./station-content";

export { StationNodeBody } from "./station-content";

export type StationFlowNode = FlowNode<
  Extract<GraphNode, { type: "station" }>["data"],
  "station"
>;

/** The canvas adds the source's audio port to its shared controls. */
export function StationNode(props: FlowNodeProps<StationFlowNode>) {
  const lane = useSourceLane(props.id);
  return (
    <>
      <StationNodeContent {...props} />
      <SourceOutPort
        isLive={lane.isPlaying && !lane.isLoading}
        name={props.data.radio?.name ?? "Station"}
        type="station"
      />
    </>
  );
}
