"use client";

import { useEffect, useState } from "react";
import { getSoundCloudStreamUrl } from "./actions";

type SoundCloudPlayerProps = {
  url: string;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  preload?: "none" | "metadata" | "auto";
};

export function SoundCloudPlayer({
  url,
  className,
  autoPlay = false,
  controls = true,
  preload = "metadata",
}: SoundCloudPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStream() {
      try {
        setIsLoading(true);
        setError(null);

        const streamUrl = await getSoundCloudStreamUrl(url);
        setAudioUrl(streamUrl);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load stream";
        setError(errorMessage);
        console.error("Error loading SoundCloud stream:", err);
      } finally {
        setIsLoading(false);
      }
    }

    if (url) {
      loadStream();
    }
  }, [url]);

  if (isLoading) {
    return (
      <div className={className}>
        <div className="text-muted-foreground text-sm">
          Loading SoundCloud track...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <div className="text-destructive text-sm">Error: {error}</div>
      </div>
    );
  }

  if (!audioUrl) {
    return null;
  }

  return (
    <audio
      autoPlay={autoPlay}
      className={className}
      controls={controls}
      preload={preload}
      src={audioUrl}
    >
      <track kind="captions" />
      Your browser does not support the audio element.
    </audio>
  );
}
