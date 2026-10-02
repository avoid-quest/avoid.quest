import { useNodeSession } from "@/lib/hooks/use-node-session";
import { getNodePlayback } from "@/lib/node-playback";
import { EmptyHint } from "../empty-hint";
import { inputFeedback } from "./flow-elements";
import { NodeMasterControls } from "./node-master";
import {
  type NodeLaneControls,
  NodeSourceRow,
  RepickFileRow,
  repickFiles,
} from "./node-source-row";

/**
 * The performance surface on a phone: the master first, then every source
 * (Stations and Audio inputs) with its play or Go live and volume, and a
 * File to pick again after a reload. Routing lives in the Rack and on the
 * Patch.
 */
export function NodeStage({
  controls = getNodePlayback(),
}: {
  controls?: NodeLaneControls;
}) {
  const { graph, sources } = useNodeSession();
  // A gone file has no lane; one still in a stale lane cache shows once.
  const repick = repickFiles(graph).filter(
    (file) => !sources.some((source) => source.id === file.id)
  );

  return (
    <div className="flex flex-col gap-2">
      <NodeMasterControls className="rounded-lg border border-border/50 bg-card/50 p-2" />
      {sources.length > 0 || repick.length > 0 ? (
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
          {repick.map((file) => (
            <RepickFileRow key={file.id} nodeId={file.id} radio={file.radio} />
          ))}
        </ul>
      ) : (
        <EmptyHint className="py-10">Search to add a station</EmptyHint>
      )}
    </div>
  );
}
