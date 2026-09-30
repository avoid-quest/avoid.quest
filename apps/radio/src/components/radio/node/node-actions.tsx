import { createContext, useContext } from "react";
import type { Radio } from "@/lib/audio";
import type { NodeRadioManagement } from "./use-node-radio-management";

/**
 * What canvas nodes need from the mode around them: station management and
 * the saved stations an empty slot's search offers first. Playback goes
 * straight to node playback, and live state to the runtime store.
 */
export type NodeActions = Pick<
  NodeRadioManagement,
  | "fillStation"
  | "handleDeleteRadio"
  | "handleEditRadio"
  | "handleSaveSessionRadio"
  | "handleToggleRadio"
  | "saveDiscoveredStation"
  | "selectDiscoveredForStation"
> & {
  radios: Radio[];
  /** Removes a node from its menu, healing the path it sat on. */
  removeNode: (nodeId: string) => void;
  /** "Swap effect…" on an FX node: pick the effect it becomes. */
  swapEffect: (nodeId: string) => void;
  /** Opens every param of an FX or native strip node in the inspector. */
  inspectNode: (nodeId: string) => void;
};

const NodeActionsContext = createContext<NodeActions | null>(null);

export const NodeActionsProvider = NodeActionsContext.Provider;

export function useNodeActions(): NodeActions {
  const actions = useContext(NodeActionsContext);
  if (!actions) {
    throw new Error("useNodeActions must be used inside NodeActionsProvider");
  }
  return actions;
}
