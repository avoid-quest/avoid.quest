import { useNodeSession } from "@/lib/hooks/use-node-session";
import { getNodePlayback } from "@/lib/node-playback";
import { EmptyHint } from "../empty-hint";
import { NodeMasterControls } from "./node-master";
import { NodeSourceRow } from "./node-source-row";

/**
 * The performance surface on a phone: the master first, then every source
 * with its play and volume. Routing lives in the Rack and on the Patch.
 */
export function NodeStage() {
  const { sources } = useNodeSession();
  const controls = getNodePlayback();

  return (
    <div className="flex flex-col gap-2">
      <NodeMasterControls className="rounded-lg border border-border/50 bg-card/50 p-2" />
      {sources.length > 0 ? (
        <div className="flex flex-col gap-1">
          {sources.map((source) => (
            <NodeSourceRow
              controls={controls}
              key={source.id}
              muted={source.isMuted}
              nodeId={source.id}
              radio={source.radio}
              volume={source.volume}
            />
          ))}
        </div>
      ) : (
        <EmptyHint className="py-10">Search to add a station</EmptyHint>
      )}
    </div>
  );
}
