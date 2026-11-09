import type { Radio } from "@/lib/audio";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";

/** A text cue alongside the session colour, shared by every player mode. */
export function StationSaveStatus({ radio }: { radio: Radio }) {
  if (!isSessionRadio(radio)) {
    return null;
  }
  return (
    <span className="inline-flex shrink-0 border border-border/70 px-1.5 py-0.5 text-muted-foreground text-xs leading-none">
      Not saved
    </span>
  );
}
