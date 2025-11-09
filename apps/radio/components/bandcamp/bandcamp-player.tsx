"use client";

import { useEffect, useState } from "react";
import { getBandcampTrackUrl } from "./actions";

type BandcampPlayerProps = {
  url: string;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  preload?: "none" | "metadata" | "auto";
};

export function BandcampPlayer({
  url,
  className,
  autoPlay = false,
  controls = true,
  preload = "metadata",
}: BandcampPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStream() {
      try {
        setIsLoading(true);
        setError(null);

        const streamUrl = await getBandcampTrackUrl(url);
        if (streamUrl) {
          setAudioUrl(streamUrl);
        } else {
          throw new Error("No stream url found");
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load stream";
        setError(errorMessage);
        console.error("Error loading Bandcamp stream:", err);
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
          Loading Bandcamp track...
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
    return (
      <div className={className}>
        <div className="text-muted-foreground text-sm">
          No stream url found for Bandcamp track
        </div>
      </div>
    );
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
