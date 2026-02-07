import { type RefObject, useEffect, useRef } from "react";
import { disposeAudioEngine, getAudioEngine } from "@/lib/audio";

type UseAudioOptions = {
  scrollRef: RefObject<HTMLDivElement | null>;
  itemHeight: number;
  audioEnabled: boolean;
  audioVolume: number;
};

export function useAudio({
  scrollRef,
  itemHeight,
  audioEnabled,
  audioVolume,
}: UseAudioOptions): void {
  const prevIndexRef = useRef(0);
  const wasEnabledRef = useRef(audioEnabled);

  // Sync volume changes
  useEffect(() => {
    if (!audioEnabled) {
      return;
    }
    getAudioEngine().setVolume(audioVolume);
  }, [audioEnabled, audioVolume]);

  // Listen for scroll events directly — bypasses React render cycle
  useEffect(() => {
    if (!audioEnabled) {
      return;
    }

    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const handleScroll = () => {
      const currentIndex = Math.floor(el.scrollTop / itemHeight);
      if (currentIndex === prevIndexRef.current) {
        return;
      }
      prevIndexRef.current = currentIndex;
      getAudioEngine().playRandom();
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [audioEnabled, scrollRef, itemHeight]);

  // Dispose only when toggling enabled → disabled
  useEffect(() => {
    if (wasEnabledRef.current && !audioEnabled) {
      disposeAudioEngine();
    }
    wasEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      disposeAudioEngine();
    };
  }, []);
}
