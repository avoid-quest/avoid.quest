import { z } from "zod";
import { getAudioEngine } from "./audio-engine";

const SampleManifestSchema = z.object({
  samples: z.array(z.object({ key: z.string(), size: z.number() })),
});

const BATCH_SIZE = 4;

export async function loadSampleManifest(): Promise<string[]> {
  try {
    const response = await fetch("/api/audio-samples");
    if (!response.ok) {
      return [];
    }

    const data = SampleManifestSchema.parse(await response.json());
    return data.samples.map((s) => s.key);
  } catch (error: unknown) {
    console.warn("[loader] Failed to load sample manifest:", error);
    return [];
  }
}

export async function preloadSamples(keys: string[]): Promise<void> {
  const engine = getAudioEngine();
  if (!engine) {
    return;
  }

  let failureCount = 0;

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (key) => {
        try {
          await engine.loadSample(
            key,
            `/api/audio-sample?key=${encodeURIComponent(key)}`
          );
        } catch {
          failureCount++;
        }
      })
    );
  }

  if (failureCount === keys.length) {
    console.warn(`All ${failureCount} audio samples failed to load`);
  }
}
