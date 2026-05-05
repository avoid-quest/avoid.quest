import { useEffect } from "react";
import { useEnabledRadios } from "@/lib/hooks/use-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import { synchronizePlaybackMode } from "@/lib/mode-lifecycle-manager";
import { DjPlayer } from "./dj/dj-player";
import { MultipleRadios } from "./multiple";
import { SingleRadio } from "./single";

export function Radios() {
  const { data: radios } = useEnabledRadios();
  const { data: settings } = useSettings();

  const enabledRadios = radios ?? [];
  const mode = settings?.player.mode;

  useEffect(() => {
    if (!mode) {
      return;
    }
    synchronizePlaybackMode(mode).catch((error) => {
      console.error("[radio] Failed to synchronize playback mode:", error);
    });
  }, [mode]);

  if (mode === "single") {
    return <SingleRadio radios={enabledRadios} />;
  }
  if (mode === "dj") {
    return <DjPlayer radios={enabledRadios} />;
  }
  return <MultipleRadios radios={enabledRadios} />;
}
