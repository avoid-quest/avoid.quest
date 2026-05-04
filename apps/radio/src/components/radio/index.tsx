import { useLiveQuery } from "@tanstack/react-db";
import { useEffect } from "react";
import { playbackSessionsCollection } from "@/lib/collections/playback-sessions";
import { useEnabledRadios } from "@/lib/hooks/use-radios";
import { useSettings } from "@/lib/hooks/use-settings";
import { modeManager } from "@/lib/mode-lifecycle-manager";
import { DjPlayer } from "./dj/dj-player";
import { MultipleRadios } from "./multiple";
import { SingleRadio } from "./single";

export function Radios() {
  const { data: radios } = useEnabledRadios();
  const { data: settings } = useSettings();
  const { data: playbackSessions } = useLiveQuery((q) =>
    q.from({ session: playbackSessionsCollection })
  );

  const enabledRadios = radios ?? [];
  const mode = settings?.player.mode;
  const activeSession = playbackSessions?.find(
    (session) => session.id === mode
  );

  useEffect(() => {
    if (!mode) {
      return;
    }
    if (!activeSession) {
      return;
    }
    const snapshot = modeManager.getSnapshot();
    if (snapshot.currentMode === mode) {
      return;
    }
    const isInitialActivation =
      snapshot.currentMode === null && snapshot.phase === "inactive";
    const transition = isInitialActivation
      ? modeManager.activateInitialMode(mode)
      : modeManager.switchTo(mode);

    transition.catch((error) => {
      console.error("[radio] Failed to synchronize playback mode:", error);
    });
  }, [mode, activeSession]);

  if (mode === "single") {
    return <SingleRadio radios={enabledRadios} />;
  }
  if (mode === "dj") {
    return <DjPlayer radios={enabledRadios} />;
  }
  return <MultipleRadios radios={enabledRadios} />;
}
