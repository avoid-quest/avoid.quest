import { laneChannelId } from "@/lib/node-graph/compile";
import { usePlaybackChannelRuntimeView } from "@/lib/stores/playback-runtime-store";
import { AudioInputNodeContent } from "./audio-input-content";
import type { FlowNode, FlowNodeProps } from "./flow-adapter";
import type { AudioInputNodeData } from "./flow-elements";
import { SourceOutPort } from "./source-out-port";

export { AUDIO_INPUT_NAME, AudioInputNodeBody } from "./audio-input-content";
export type AudioInputFlowNode = FlowNode<AudioInputNodeData, "deviceIn">;

/** The canvas adds the input's audio port to its shared controls. */
export function AudioInputNode(props: FlowNodeProps<AudioInputFlowNode>) {
  const runtime = usePlaybackChannelRuntimeView(laneChannelId(props.id));
  const title =
    (props.data.deviceId && props.data.deviceLabel) || "Audio input";
  return (
    <>
      <AudioInputNodeContent {...props} />
      <SourceOutPort
        isLive={Boolean(runtime?.isPlaying && !runtime.isLoading)}
        name={title}
        type="deviceIn"
      />
    </>
  );
}
