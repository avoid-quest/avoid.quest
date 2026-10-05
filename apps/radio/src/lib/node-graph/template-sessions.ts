import type { PlaybackSessionRecord } from "@/lib/collections/playback-sessions";
import { type CompileEnv, compile } from "./compile";
import type { NodeGraph } from "./schema";
import { deriveNodeChannels } from "./session-channels";
import { nodeSessionRecord } from "./session-record";
import {
  buildNodeGraphFromTemplate,
  type NodeTemplateId,
  type NodeTemplateSources,
} from "./templates";

/** The `"node"` playback session for a template, lane channels included. */
export function buildNodeSessionFromTemplate(
  template: NodeTemplateId,
  sources: NodeTemplateSources = {},
  env: CompileEnv = { crossOriginIsolated: false }
): PlaybackSessionRecord {
  return buildNodeSessionFromGraph(
    buildNodeGraphFromTemplate(template, sources),
    sources.masterVolume,
    env
  );
}

/** The `"node"` playback session holding `graph`, lane channels included. */
export function buildNodeSessionFromGraph(
  graph: NodeGraph,
  masterVolume = 1,
  env: CompileEnv = { crossOriginIsolated: false }
): PlaybackSessionRecord {
  return nodeSessionRecord(
    graph,
    deriveNodeChannels(compile(graph, env)),
    masterVolume
  );
}
