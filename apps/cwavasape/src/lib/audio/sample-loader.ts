import { getAudioEngine } from "./audio-engine";

type SampleManifestEntry = {
  key: string;
  size: number;
};

const BATCH_SIZE = 4;

export async function loadSampleManifest(): Promise<string[]> {
  const response = await fetch("/api/audio-samples");
  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { samples: SampleManifestEntry[] };
  return data.samples.map((s) => s.key);
}

export async function preloadSamples(keys: string[]): Promise<void> {
  const engine = getAudioEngine();

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((key) =>
        engine
          .loadSample(key, `/api/audio-sample?key=${encodeURIComponent(key)}`)
          .catch(() => {
            // Individual sample load failure is not critical
          })
      )
    );
  }
}
