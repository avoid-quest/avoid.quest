import { useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import { useSettings } from "@/lib/hooks/use-settings";
import { useSingleState } from "@/lib/hooks/use-single-state";

export function useSingleStateHydration(
  selectRadio: (radio: Radio) => Promise<void>,
  setVolume: (volume: number) => void,
  hasSingleSession: boolean
) {
  const { data: settings } = useSettings();
  const singleState = useSingleState();
  const hasHydratedRef = useRef(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const selectRadioRef = useRef(selectRadio);
  const setVolumeRef = useRef(setVolume);
  useEffect(() => {
    selectRadioRef.current = selectRadio;
    setVolumeRef.current = setVolume;
  }, [selectRadio, setVolume]);

  useEffect(() => {
    if (hasHydratedRef.current) {
      return;
    }

    if (
      settings !== undefined &&
      settings?.player?.restoreStateOnLoad === false
    ) {
      hasHydratedRef.current = true;
      setIsHydrated(true);
      return;
    }

    const shouldRestore = settings?.player?.restoreStateOnLoad !== false;
    if (!shouldRestore) {
      return;
    }

    if (
      settings === undefined ||
      singleState === undefined ||
      !hasSingleSession
    ) {
      return;
    }

    hasHydratedRef.current = true;

    if (singleState.volume !== undefined) {
      setVolumeRef.current(singleState.volume);
    }

    if (singleState.radio) {
      selectRadioRef.current(singleState.radio).catch((error) => {
        console.error("[radio] Failed to restore radio:", error);
      });
    }

    setIsHydrated(true);
  }, [hasSingleSession, settings, singleState]);

  return isHydrated;
}
