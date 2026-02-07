import { useState } from "react";
import {
  createAudioEngine,
  loadSampleManifest,
  preloadSamples,
} from "@/lib/audio";
import { setAudioEnabled } from "@/lib/collections/settings";
import { DEFAULT_AUDIO_VOLUME } from "@/lib/const";

export function InteractionGate({ children }: { children: React.ReactNode }) {
  const [dismissed, setDismissed] = useState(false);

  return (
    <>
      {children}
      {!dismissed && (
        <button
          className="fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-black"
          onClick={() => {
            const engine = createAudioEngine();
            engine.initialize();
            engine.resume();
            engine.setVolume(DEFAULT_AUDIO_VOLUME);

            setAudioEnabled(true);

            loadSampleManifest()
              .then(async (keys) => {
                if (keys.length > 0) {
                  await preloadSamples(keys);
                }
              })
              .catch((error: unknown) => {
                console.warn("[gate] Failed to load audio samples:", error);
              });

            setDismissed(true);
          }}
          type="button"
        >
          <span className="text-sm text-white/50 uppercase tracking-widest">
            click to enter
          </span>
        </button>
      )}
    </>
  );
}
