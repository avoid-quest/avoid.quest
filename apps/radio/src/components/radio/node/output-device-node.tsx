import { findPort } from "@/lib/node-graph/catalogue";
import { type FlowNode, type FlowNodeProps, Position } from "./flow-adapter";
import type { OutputDeviceNodeData } from "./flow-elements";
import { NodePort } from "./module-frame";
import {
  OUTPUT_DEVICE_NAME,
  OutputDeviceNodeContent,
} from "./output-device-content";

export {
  OUTPUT_DEVICE_NAME,
  OutputDeviceNodeBody,
} from "./output-device-content";
export type OutputDeviceFlowNode = FlowNode<OutputDeviceNodeData, "deviceOut">;
const AUDIO_IN = findPort("deviceOut", "in", "audio", "main");

/** The canvas adds the output's audio port to its shared controls. */
export function OutputDeviceNode(props: FlowNodeProps<OutputDeviceFlowNode>) {
  const title =
    (props.data.deviceId && props.data.deviceLabel) || OUTPUT_DEVICE_NAME;
  return (
    <>
      {AUDIO_IN ? (
        <NodePort
          ariaLabel={`${title} audio in`}
          label="Audio in"
          port={AUDIO_IN}
          position={Position.Left}
          type="deviceOut"
        />
      ) : null}
      <OutputDeviceNodeContent {...props} />
    </>
  );
}
