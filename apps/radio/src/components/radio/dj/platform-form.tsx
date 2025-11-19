import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Loader2, Music } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  detectBandcampItemType,
  detectPlatformFromUrl,
  detectSoundCloudItemType,
} from "@/lib/external-url/detect";
import type { Platform, PlatformItemResponse } from "@/lib/external-url/types";
import { createPlatformRadio } from "@/lib/external-url/utils";
import type { Radio } from "@/lib/types";

type PlatformFormProps = {
  onLoad: (radio: Radio) => void;
  initialPlatform?: Platform;
};

function getItemTypeLabel(
  platform: Platform | null,
  url: string
): string | null {
  if (!(platform && url)) {
    return null;
  }

  if (platform === "bandcamp") {
    const itemType = detectBandcampItemType(url);
    const labels: Record<typeof itemType, string> = {
      album: "Album",
      track: "Track",
      artist: "Artist",
      label: "Label",
    };
    return labels[itemType] ?? null;
  }

  if (platform === "soundcloud") {
    const itemType = detectSoundCloudItemType(url);
    const labels: Record<typeof itemType, string> = {
      track: "Track",
      playlist: "Playlist/Set",
      user: "User",
    };
    return labels[itemType] ?? null;
  }

  return null;
}

export function PlatformForm({ onLoad, initialPlatform }: PlatformFormProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const detectedPlatform = detectPlatformFromUrl(url);
  const itemTypeLabel = getItemTypeLabel(detectedPlatform, url);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/load-platform-item", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      const result = (await response.json()) as PlatformItemResponse;

      if (!result.success) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      const radio = createPlatformRadio(result.streamUrl, result.metadata);
      onLoad(radio);
      // Reset form after successful load
      setUrl("");
      setError(null);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to process URL";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const getPlaceholder = (): string => {
    if (initialPlatform === "bandcamp") {
      return "https://artist.bandcamp.com/track/track-name or /album/album-name";
    }
    if (initialPlatform === "soundcloud") {
      return "https://soundcloud.com/artist/track-name or /sets/playlist-name";
    }
    return "Paste a Bandcamp or SoundCloud URL";
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Music className="size-5" />
          <h3 className="font-medium text-sm">Add Platform Item</h3>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input
              disabled={isLoading}
              id="url"
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              onPaste={(e) => {
                const pastedText = e.clipboardData.getData("text");
                if (pastedText && detectPlatformFromUrl(pastedText)) {
                  e.preventDefault();
                  setUrl(pastedText.trim());
                  setError(null);
                }
              }}
              placeholder={getPlaceholder()}
              ref={inputRef}
              type="url"
              value={url}
            />
            {detectedPlatform && itemTypeLabel && (
              <p className="text-muted-foreground text-xs">
                Detected:{" "}
                {detectedPlatform === "bandcamp" ? "Bandcamp" : "SoundCloud"} •{" "}
                {itemTypeLabel}
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          <Button
            className="w-full"
            disabled={isLoading || !url.trim()}
            type="submit"
          >
            {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
            Load
          </Button>
        </form>
      </div>
    </div>
  );
}
