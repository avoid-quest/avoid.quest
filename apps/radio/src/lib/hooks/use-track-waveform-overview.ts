import { useEffect, useState } from "react";
import type { Radio } from "@/lib/audio";
import {
  isFileMetadata,
  isStaticAudioMetadata,
  type PlatformMetadata,
} from "@/lib/platform-types";
import { buildProxyUrl } from "@/lib/audio/html5/load-mode";

const waveformCache = new Map<string, number[]>();
const DEFAULT_SAMPLE_COUNT = 160;

type WaveformSource = {
  url: string;
  cacheKey: string;
};

function getWaveformSource(
  radio: Radio | null,
  metadata: PlatformMetadata | undefined
): WaveformSource | null {
  if (!radio || !metadata) {
    return null;
  }

  if (isFileMetadata(metadata)) {
    return {
      url: metadata.objectUrl,
      cacheKey: metadata.objectUrl,
    };
  }

  if (isStaticAudioMetadata(metadata) && metadata.itemType === "track") {
    if (metadata.streamUrl.startsWith("blob:")) {
      return {
        url: metadata.streamUrl,
        cacheKey: metadata.streamUrl,
      };
    }

    if (metadata.requiresProxy && metadata.url) {
      return {
        url: buildProxyUrl(metadata.url),
        cacheKey: `proxy:${metadata.url}`,
      };
    }

    if (metadata.url.startsWith("http://") || metadata.url.startsWith("https://")) {
      return {
        url: metadata.url,
        cacheKey: metadata.url,
      };
    }
  }

  return null;
}

async function buildWaveformOverview(
  url: string,
  sampleCount: number
): Promise<number[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Waveform fetch failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const context = new AudioContext();

  try {
    const audioBuffer = await context.decodeAudioData(buffer.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    const samplesPerBucket = Math.max(
      1,
      Math.floor(channelData.length / sampleCount)
    );
    const next: number[] = [];

    for (let bucket = 0; bucket < sampleCount; bucket++) {
      const start = bucket * samplesPerBucket;
      const end = Math.min(channelData.length, start + samplesPerBucket);
      let peak = 0;
      for (let i = start; i < end; i++) {
        peak = Math.max(peak, Math.abs(channelData[i] ?? 0));
      }
      next.push(peak);
    }

    const max = Math.max(...next, 0.0001);
    return next.map((value) => value / max);
  } finally {
    await context.close();
  }
}

export function useTrackWaveformOverview(
  radio: Radio | null,
  metadata: PlatformMetadata | undefined,
  enabled: boolean,
  sampleCount = DEFAULT_SAMPLE_COUNT
): {
  samples: number[] | null;
  loading: boolean;
} {
  const [samples, setSamples] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSamples(null);
      setLoading(false);
      return;
    }

    const source = getWaveformSource(radio, metadata);
    if (!source) {
      setSamples(null);
      setLoading(false);
      return;
    }

    const cacheKey = `${source.cacheKey}::${sampleCount}`;
    const cached = waveformCache.get(cacheKey);
    if (cached) {
      setSamples(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    buildWaveformOverview(source.url, sampleCount)
      .then((result) => {
        if (cancelled) {
          return;
        }
        waveformCache.set(cacheKey, result);
        setSamples(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setSamples(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, metadata, radio, sampleCount]);

  return { samples, loading };
}
