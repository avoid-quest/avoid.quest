import { useNodeSession } from "@/lib/hooks/use-node-session";
import { getNodePlayback } from "@/lib/node-playback";
import { EmptyHint } from "../empty-hint";
import { inputFeedback } from "./flow-elements";
import { NodeMasterControls } from "./node-master";
import { type NodeLaneControls, NodeSourceRow } from "./node-source-row";

/**
 * The performance surface on a phone: the master first, then every source
 * (Stations and Audio inputs) with its play or Go live and volume. Routing
 * lives in the Rack and on the Patch.
 */
export function NodeStage({
  controls = getNodePlayback(),
}: {
  controls?: NodeLaneControls;
}) {
  const { graph, sources } = useNodeSession();

  return (
    <div className="flex flex-col gap-2">
      <NodeMasterControls className="rounded-lg border border-border/50 bg-card/50 p-2" />
      {sources.length > 0 ? (
        <ul aria-label="Sources" className="flex flex-col gap-1">
          {sources.map((source) => (
            <li key={source.id}>
              <NodeSourceRow
                controls={controls}
                feedback={inputFeedback(graph, source.id)}
                muted={source.isMuted}
                nodeId={source.id}
                radio={source.radio}
                volume={source.volume}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyHint className="py-10">Search to add a station</EmptyHint>
      )}
    </div>
  );
}
