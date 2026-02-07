import { useEffect, useRef } from "react";
import { disposeAudioEngine, getAudioEngine } from "@/lib/audio";

type UseAudioOptions = {
  scrollElement: HTMLDivElement | null;
  itemHeight: number;
  audioEnabled: boolean;
  audioVolume: number;
};

export function useAudio({
  scrollElement,
  itemHeight,
  audioEnabled,
  audioVolume,
}: UseAudioOptions): void {
  const prevIndexRef = useRef(0);
  const wasEnabledRef = useRef(audioEnabled);

  // Sync volume changes
  useEffect(() => {
    getAudioEngine()?.setVolume(audioVolume);
  }, [audioVolume]);

  // Scroll listener
  useEffect(() => {
    if (!(audioEnabled && scrollElement)) {
      return;
    }

    const handleScroll = () => {
      const currentIndex = Math.floor(scrollElement.scrollTop / itemHeight);
      if (currentIndex === prevIndexRef.current) {
        return;
      }
      prevIndexRef.current = currentIndex;

      const engine = getAudioEngine();
      if (engine?.isInitialized) {
        engine.playRandom();
      }
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollElement.removeEventListener("scroll", handleScroll);
  }, [scrollElement, itemHeight, audioEnabled]);

  // Dispose when toggling enabled → disabled
  useEffect(() => {
    if (wasEnabledRef.current && !audioEnabled) {
      disposeAudioEngine();
    }
    wasEnabledRef.current = audioEnabled;
  }, [audioEnabled]);
}
