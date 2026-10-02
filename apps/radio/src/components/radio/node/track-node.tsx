import type { GraphNode } from "@/lib/node-graph/schema";
import type { FlowNode, FlowNodeProps } from "./flow-adapter";
import { useSourceLane } from "./source-node-frame";
import { SourceOutPort } from "./source-out-port";
import { TrackNodeContent } from "./track-content";

export {
  PlatformChips,
  sourceChipOf,
  TrackCard,
  TrackNodeBody,
} from "./track-content";

export type TrackFlowNode = FlowNode<
  Extract<GraphNode, { type: "platform" }>["data"],
  "platform"
>;

/** The canvas adds the source's audio port to its shared controls. */
export function TrackNode(props: FlowNodeProps<TrackFlowNode>) {
  const lane = useSourceLane(props.id);
  return (
    <>
      <TrackNodeContent {...props} />
      <SourceOutPort
        isLive={lane.isPlaying && !lane.isLoading}
        name={props.data.radio?.name ?? "Track"}
        type="platform"
      />
    </>
  );
}
