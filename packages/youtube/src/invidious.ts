import type { AudioFormat } from "./types.js";

const INVIDIOUS_INSTANCES_URL =
  "https://api.invidious.io/instances.json?sort_by=api,type";

const FALLBACK_INSTANCES = [
  "https://invidious.fdn.fr",
  "https://inv.tux.pizza",
  "https://invidious.privacyredirect.com",
  "https://invidious.protokolla.fi",
];

let cachedInstances: string[] | null = null;
let instanceIndex = 0;

type InvidiousVideoData = {
  title: string;
  author: string;
  videoId: string;
  videoThumbnails: { url: string; quality: string }[];
  lengthSeconds: number;
  adaptiveFormats: AudioFormat[];
};

type InvidiousPlaylistVideo = {
  title: string;
  videoId: string;
  author: string;
  lengthSeconds: number;
  videoThumbnails: { url: string; quality: string }[];
};

type InvidiousPlaylistData = {
  title: string;
  author: string;
  playlistId: string;
  playlistThumbnail: string;
  videos: InvidiousPlaylistVideo[];
  videoCount: number;
};

export async function fetchInvidiousInstances(): Promise<string[]> {
  if (cachedInstances) {
    return cachedInstances;
  }

  try {
    const response = await fetch(INVIDIOUS_INSTANCES_URL, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      cachedInstances = FALLBACK_INSTANCES;
      return cachedInstances;
    }

    const data = (await response.json()) as [
      string,
      { uri: string; api: boolean; type: string },
    ][];

    const instances = data
      .filter(([, info]) => info.api && info.type === "https")
      .map(([, info]) => info.uri)
      .slice(0, 10);

    cachedInstances = instances.length > 0 ? instances : FALLBACK_INSTANCES;
    return cachedInstances;
  } catch {
    cachedInstances = FALLBACK_INSTANCES;
    return cachedInstances;
  }
}

function fetchFromInstance(instance: string, path: string): Promise<Response> {
  return fetch(`${instance}${path}`, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/json",
    },
  });
}

export async function getVideoData(
  videoId: string,
  instances?: string[]
): Promise<InvidiousVideoData> {
  const hosts = instances ?? (await fetchInvidiousInstances());
  const path = `/api/v1/videos/${videoId}`;

  let lastError: Error | null = null;

  for (let i = 0; i < hosts.length; i++) {
    const idx = (instanceIndex + i) % hosts.length;
    const instance = hosts[idx];
    if (!instance) {
      continue;
    }

    try {
      const response = await fetchFromInstance(instance, path);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        throw new Error(`Non-JSON response: ${contentType}`);
      }

      const data = (await response.json()) as
        | InvidiousVideoData
        | { error: string };

      if ("error" in data) {
        throw new Error(data.error);
      }

      if (!data.adaptiveFormats?.length) {
        throw new Error("No adaptive formats found");
      }

      instanceIndex = idx;
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
    }
  }

  throw lastError ?? new Error("All Invidious instances failed");
}

export async function getPlaylistData(
  playlistId: string,
  instances?: string[]
): Promise<InvidiousPlaylistData> {
  const hosts = instances ?? (await fetchInvidiousInstances());
  const path = `/api/v1/playlists/${playlistId}`;

  let lastError: Error | null = null;

  for (let i = 0; i < hosts.length; i++) {
    const idx = (instanceIndex + i) % hosts.length;
    const instance = hosts[idx];
    if (!instance) {
      continue;
    }

    try {
      const response = await fetchFromInstance(instance, path);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        throw new Error(`Non-JSON response: ${contentType}`);
      }

      const data = (await response.json()) as
        | InvidiousPlaylistData
        | { error: string };

      if ("error" in data) {
        throw new Error(data.error);
      }

      instanceIndex = idx;
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
    }
  }

  throw lastError ?? new Error("All Invidious instances failed");
}

export function selectBestAudioStream(
  formats: AudioFormat[]
): AudioFormat | null {
  const audioFormats = formats.filter((f) => f.type.startsWith("audio"));

  if (audioFormats.length === 0) {
    return null;
  }

  // Prefer Opus itag 251 (high quality), then AAC itag 140
  const opus251 = audioFormats.find((f) => f.itag === "251");
  if (opus251) {
    return opus251;
  }

  const aac140 = audioFormats.find((f) => f.itag === "140");
  if (aac140) {
    return aac140;
  }

  // Fallback: sort by bitrate descending
  audioFormats.sort(
    (a, b) => Number.parseInt(b.bitrate, 10) - Number.parseInt(a.bitrate, 10)
  );
  return audioFormats[0] ?? null;
}

export function getBestThumbnail(
  thumbnails: { url: string; quality: string }[]
): string | undefined {
  const preferred = ["maxres", "sddefault", "high", "medium", "default"];
  for (const quality of preferred) {
    const thumb = thumbnails.find((t) => t.quality === quality);
    if (thumb) {
      return thumb.url;
    }
  }
  return thumbnails[0]?.url;
}
