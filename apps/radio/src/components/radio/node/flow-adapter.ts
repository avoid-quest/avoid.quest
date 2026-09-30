/**
 * Flow Adapter
 *
 * The only module that imports React Flow. Node mode reaches `@xyflow/react`
 * through these names, so a React Flow 13 migration (colorMode, `useStore`,
 * CSS layers) changes this file and not the canvas. It is reachable only
 * from the lazy client canvas chunk, never from the Worker bundle.
 */

export type {
  AriaLabelConfig as FlowAriaLabelConfig,
  Connection as FlowConnection,
  Edge as FlowEdge,
  EdgeChange as FlowEdgeChange,
  FinalConnectionState as FlowConnectionEnd,
  IsValidConnection as FlowIsValidConnection,
  Node as FlowNode,
  NodeChange as FlowNodeChange,
  NodeProps as FlowNodeProps,
  NodeTypes as FlowNodeTypes,
  Viewport as FlowViewport,
} from "@xyflow/react";
export {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
