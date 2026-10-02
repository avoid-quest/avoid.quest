import { cn } from "@avoid.quest/ui/lib/utils";
import { SpeakerIcon } from "lucide-react";
import { findPort } from "@/lib/node-graph/catalogue";
import type { GraphNode } from "@/lib/node-graph/schema";
import { type FlowNode, type FlowNodeProps, Position } from "./flow-adapter";
import { keepControlKeys, NodePort } from "./module-frame";
import { NodeMasterControls } from "./node-master";

const AUDIO_IN = findPort("speakers", "in", "audio", "main");

type SpeakersData = Extract<GraphNode, { type: "speakers" }>["data"];
export type SpeakersFlowNode = FlowNode<SpeakersData, "speakers">;

/**
 * The main bus: Play all / Pause all, master volume and mute, a meter while
 * anything plays, and Resume when the browser interrupted the audio.
 */
export function SpeakersNode({ selected }: FlowNodeProps<SpeakersFlowNode>) {
  return (
    <>
      {AUDIO_IN ? (
        <NodePort
          ariaLabel="Speakers audio in"
          label="Audio in"
          port={AUDIO_IN}
          position={Position.Left}
          type="speakers"
        />
      ) : null}
      <div
        className={cn(
          "w-50 rounded-md border bg-card text-card-foreground",
          selected ? "border-ring" : "border-border/50"
        )}
      >
        <div className="flex h-8 items-center gap-2 px-2">
          <span className="flex size-6 items-center justify-center rounded-sm bg-muted text-muted-foreground">
            <SpeakerIcon aria-hidden="true" className="size-3.5" />
          </span>
          <span className="font-medium text-xs">Speakers</span>
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: holds its controls' keys; each control is focusable itself */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: holds its controls' keys; each control is focusable itself */}
        <div onKeyDown={keepControlKeys}>
          <NodeMasterControls className="nodrag nopan nowheel border-border/50 border-t bg-muted/30 p-2" />
        </div>
      </div>
    </>
  );
}
