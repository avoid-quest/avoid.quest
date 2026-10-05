import { compile } from "@/lib/node-graph/compile";
import type { NodeGraph } from "@/lib/node-graph/schema";
import { deriveNodeChannels } from "@/lib/node-graph/session-channels";
import { buildNodeSessionFromGraph } from "@/lib/node-graph/template-sessions";
import {
  getNodeSessionReadOnlyVersion,
  type PlaybackSessionRecord,
  persistPreparedNodeSession,
  playbackSessionsCollection,
} from "./playback-sessions";

/** Prepares and validates the entire session without writing or collecting models. */
export function prepareNodeSessionGraph(
  graph: NodeGraph,
  masterVolume?: number
): PlaybackSessionRecord {
  const session = playbackSessionsCollection.state.get("node");
  if (!session) {
    return playbackSessionsCollection.validateData(
      buildNodeSessionFromGraph(graph, masterVolume),
      "insert"
    );
  }
  const channels = deriveNodeChannels(
    compile(graph, { crossOriginIsolated: false }),
    session.channels
  );
  return playbackSessionsCollection.validateData(
    {
      ...session,
      activeChannelId: channels.some(
        (channel) => channel.id === session.activeChannelId
      )
        ? session.activeChannelId
        : null,
      channels,
      graph,
      masterVolume: masterVolume ?? session.masterVolume,
    },
    "insert"
  );
}

/** Validate and store a patch; a future patch requires an explicit replacement. */
export function writeNodeSessionGraph(
  graph: NodeGraph,
  masterVolume?: number,
  { replaceReadOnly = false }: { replaceReadOnly?: boolean } = {}
): NodeGraph | null {
  if (!replaceReadOnly && getNodeSessionReadOnlyVersion() !== null) {
    return null;
  }
  return persistPreparedNodeSession(
    graph,
    prepareNodeSessionGraph(graph, masterVolume)
  );
}
