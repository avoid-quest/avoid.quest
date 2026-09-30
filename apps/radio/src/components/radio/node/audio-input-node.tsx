import { cn } from "@avoid.quest/ui/lib/utils";
import { useStore } from "@tanstack/react-store";
import { findPort } from "@/lib/node-graph/catalogue";
import { laneChannelId } from "@/lib/node-graph/compile";
import { playbackRuntimeStore } from "@/lib/stores/playback-runtime-store";
import { AudioInputNodeContent } from "./audio-input-content";
import { type FlowNode, type FlowNodeProps, Position } from "./flow-adapter";
import type { AudioInputNodeData } from "./flow-elements";
import { NodePort } from "./module-frame";

export { AUDIO_INPUT_NAME, AudioInputNodeBody } from "./audio-input-content";
export type AudioInputFlowNode = FlowNode<AudioInputNodeData, "deviceIn">;
const AUDIO_OUT = findPort("deviceIn", "out", "audio", "main");

/** The canvas adds the input's audio port to its shared controls. */
export function AudioInputNode(props: FlowNodeProps<AudioInputFlowNode>) {
  const runtime = useStore(
    playbackRuntimeStore,
    (state) => state.channels[laneChannelId(props.id)]
  );
  const title =
    (props.data.deviceId && props.data.deviceLabel) || "Audio input";
  return (
    <>
      <AudioInputNodeContent {...props} />
      {AUDIO_OUT ? (
        <NodePort
          ariaLabel={`${title} audio out`}
          className={cn(
            runtime?.isPlaying && !runtime.isLoading && "node-port-live"
          )}
          label="Audio out"
          port={AUDIO_OUT}
          position={Position.Right}
          type="deviceIn"
        />
      ) : null}
    </>
  );
}
