"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Loader2, Music } from "lucide-react";
import { useState } from "react";
import { getBandcampItem } from "@/components/bandcamp/actions";
import { getSoundCloudItem } from "@/components/soundcloud/actions";
import type { Platform } from "@/lib/external-url/types";
import { createPlatformRadio } from "@/lib/external-url/utils";
import type { Radio } from "@/lib/types";

type PlatformFormProps = {
  onLoad: (radio: Radio) => void;
  initialPlatform?: Platform;
};

const BANDCAMP_TRACK_PATTERN = /bandcamp\.com\/track\//i;
const BANDCAMP_ALBUM_PATTERN = /bandcamp\.com\/album\//i;
const SOUNDCLOUD_TRACK_PATTERN = /soundcloud\.com\/[^/]+\/[^/]+/i;
const SOUNDCLOUD_PLAYLIST_PATTERN = /soundcloud\.com\/[^/]+\/sets\/[^/]+/i;

function validateUrl(
  platform: Platform,
  itemType: "track" | "album" | "playlist",
  url: string
): string | null {
  if (!url.trim()) {
    return "Please enter a URL";
  }

  if (platform === "bandcamp") {
    if (!url.includes("bandcamp.com")) {
      return "Please enter a valid Bandcamp URL";
    }
    if (itemType === "track" && !BANDCAMP_TRACK_PATTERN.test(url)) {
      return "URL does not match a Bandcamp track. Make sure it contains '/track/'";
    }
    if (itemType === "album" && !BANDCAMP_ALBUM_PATTERN.test(url)) {
      return "URL does not match a Bandcamp album. Make sure it contains '/album/'";
    }
  } else if (platform === "soundcloud") {
    if (!url.includes("soundcloud.com")) {
      return "Please enter a valid SoundCloud URL";
    }
    if (itemType === "track") {
      if (SOUNDCLOUD_PLAYLIST_PATTERN.test(url)) {
        return "This URL appears to be a playlist. Track URLs should not contain '/sets/'";
      }
      if (!SOUNDCLOUD_TRACK_PATTERN.test(url)) {
        return "URL does not match a SoundCloud track format";
      }
    }
    if (itemType === "playlist" && !SOUNDCLOUD_PLAYLIST_PATTERN.test(url)) {
      return "URL does not match a SoundCloud playlist/set format. Make sure it contains '/sets/'";
    }
  }

  return null;
}

export function PlatformForm({ onLoad, initialPlatform }: PlatformFormProps) {
  const [platform, setPlatform] = useState<Platform | "">(
    initialPlatform || ""
  );
  const [itemType, setItemType] = useState<"track" | "album" | "playlist" | "">(
    ""
  );
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlatformChange = (value: Platform) => {
    setPlatform(value);
    setItemType(""); // Reset item type when platform changes
    setUrl("");
    setError(null);
  };

  const handleItemTypeChange = (value: "track" | "album" | "playlist") => {
    setItemType(value);
    setUrl("");
    setError(null);
  };

  const handleUrlChange = (value: string) => {
    setUrl(value);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!(platform && itemType)) {
      setError("Please select both platform and item type");
      return;
    }

    const validationError = validateUrl(platform, itemType, url);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let result;
      if (platform === "bandcamp") {
        result = await getBandcampItem(url.trim());
      } else {
        result = await getSoundCloudItem(url.trim());
      }

      if (!result.success) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      const radio = createPlatformRadio(result.streamUrl, result.metadata);
      onLoad(radio);
      // Reset form after successful load
      setPlatform("");
      setItemType("");
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

  const itemTypeOptions =
    platform === "bandcamp"
      ? [
          { value: "track" as const, label: "Track" },
          { value: "album" as const, label: "Album" },
        ]
      : platform === "soundcloud"
        ? [
            { value: "track" as const, label: "Track" },
            { value: "playlist" as const, label: "Playlist/Set" },
          ]
        : [];

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Music className="size-5" />
          <h3 className="font-medium text-sm">Add Platform Item</h3>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="platform">Platform</Label>
            <Select
              disabled={isLoading || !!initialPlatform}
              onValueChange={handlePlatformChange}
              value={platform}
            >
              <SelectTrigger className="w-full" id="platform">
                <SelectValue placeholder="Select platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bandcamp">Bandcamp</SelectItem>
                <SelectItem value="soundcloud">SoundCloud</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {platform && (
            <div className="space-y-2">
              <Label htmlFor="item-type">Item Type</Label>
              <Select
                disabled={isLoading}
                onValueChange={handleItemTypeChange}
                value={itemType}
              >
                <SelectTrigger className="w-full" id="item-type">
                  <SelectValue placeholder="Select item type" />
                </SelectTrigger>
                <SelectContent>
                  {itemTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {platform && itemType && (
            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input
                disabled={isLoading}
                id="url"
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder={
                  platform === "bandcamp"
                    ? itemType === "track"
                      ? "https://artist.bandcamp.com/track/track-name"
                      : "https://artist.bandcamp.com/album/album-name"
                    : platform === "soundcloud"
                      ? itemType === "track"
                        ? "https://soundcloud.com/artist/track-name"
                        : "https://soundcloud.com/artist/sets/playlist-name"
                      : ""
                }
                type="url"
                value={url}
              />
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          {platform && itemType && (
            <Button
              className="w-full"
              disabled={isLoading || !url.trim()}
              type="submit"
            >
              {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Load
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
