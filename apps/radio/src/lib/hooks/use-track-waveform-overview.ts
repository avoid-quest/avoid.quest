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
  if (!radio) {
    return null;
  }

  if (isFileMetadata(metadata)) {
    return {
      url: metadata.objectUrl,
      cacheKey: metadata.objectUrl,
    };
  }

  if (isStaticAudioMetadata(metadata) && metadata.itemType === "track") {
    if (radio.streamUrl.startsWith("blob:")) {
      return {
        url: radio.streamUrl,
        cacheKey: radio.streamUrl,
      };
    }

    const baseUrl = metadata.url || radio.streamUrl;
    if (!baseUrl) {
      return null;
    }

    if (metadata.requiresProxy) {
      return {
        url: buildProxyUrl(baseUrl),
        cacheKey: `proxy:${baseUrl}`,
      };
    }

    if (baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) {
      return {
        url: baseUrl,
        cacheKey: baseUrl,
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
  failed: boolean;
} {
  const [samples, setSamples] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSamples(null);
      setLoading(false);
      setFailed(false);
      return;
    }

    const source = getWaveformSource(radio, metadata);
    if (!source) {
      setSamples(null);
      setLoading(false);
      setFailed(false);
      return;
    }

    const cacheKey = `${source.cacheKey}::${sampleCount}`;
    const cached = waveformCache.get(cacheKey);
    if (cached) {
      setSamples(cached);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    buildWaveformOverview(source.url, sampleCount)
      .then((result) => {
        if (cancelled) {
          return;
        }
        waveformCache.set(cacheKey, result);
        setSamples(result);
        setLoading(false);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setSamples(null);
        setLoading(false);
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, metadata, radio, sampleCount]);

  return { samples, loading, failed };
}
