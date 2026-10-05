import { useEffect, useRef } from "react";
import { getMidiControl } from "@/lib/midi";
import {
  createNodeMidiActions,
  nodeMidiSignature,
} from "@/lib/midi/node-midi-actions";
import type { NodeGraph } from "@/lib/node-graph/schema";

type ActionsBinding = ReturnType<
  ReturnType<typeof getMidiControl>["bindActions"]
>;

/**
 * While Node mode is mounted, its node params are MIDI actions and `node:`
 * mappings drive them. The actions follow the patch's shape; a knob turn
 * leaves them alone, since each dispatch reads the patch it edits.
 */
export function useNodeMidi(graph: NodeGraph | null): void {
  const bindingRef = useRef<ActionsBinding | null>(null);
  const latestGraphRef = useRef(graph);
  latestGraphRef.current = graph;
  const signature = graph ? nodeMidiSignature(graph) : "";

  useEffect(() => {
    const control = getMidiControl();
    const deactivate = control.activateNode();
    const binding = control.bindActions();
    bindingRef.current = binding;
    return () => {
      binding.dispose();
      deactivate();
      if (bindingRef.current === binding) {
        bindingRef.current = null;
      }
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the signature stands for the graph's shape
  useEffect(() => {
    const latest = latestGraphRef.current;
    bindingRef.current?.update(latest ? createNodeMidiActions(latest) : []);
  }, [signature]);
}
