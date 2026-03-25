import { useEffect } from "react";
import { AudioManager } from "@/lib/audio";
import { useAnalysisData } from "@/components/audio/visualizations/use-analysis-data";

export function useDeckAnalysis(
  soundId: string | null,
  enabled = true
): ReturnType<typeof useAnalysisData>["state"] {
  const { state, handleAnalysisMessage } = useAnalysisData({ enabled });

  useEffect(() => {
    if (!soundId || !enabled) {
      return;
    }

    const audioManager = AudioManager.getInstance();
    return audioManager.subscribeAnalysis(soundId, handleAnalysisMessage);
  }, [enabled, handleAnalysisMessage, soundId]);

  return state;
}
