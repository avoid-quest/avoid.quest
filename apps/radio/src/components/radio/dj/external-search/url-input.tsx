import { Button } from "@avoid.quest/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@avoid.quest/ui/components/collapsible";
import { Input } from "@avoid.quest/ui/components/input";
import { ChevronRightIcon, LinkIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import { usePlatformLoad } from "@/lib/hooks/use-platform-query";

type UrlInputProps = {
  onLoad: (radio: Radio) => void;
  onCancel?: () => void;
};

export function UrlInput({ onLoad, onCancel }: UrlInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detectedPlatform = detectPlatformFromUrl(url);

  const { mutate: loadItem, isPending } = usePlatformLoad({
    onSuccess: (radio) => {
      onLoad(radio);
      setUrl("");
      setError(null);
    },
    onError: (errorMessage) => {
      setError(errorMessage);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }
    setError(null);
    loadItem(url);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData("text");
    if (pastedText?.trim() && detectPlatformFromUrl(pastedText)) {
      e.preventDefault();
      setUrl(pastedText.trim());
      setError(null);
    }
  };

  const platformLabels: Record<string, string> = {
    bandcamp: "Bandcamp",
    soundcloud: "SoundCloud",
    youtube: "YouTube",
    "static-audio": "Audio File",
  };

  return (
    <Collapsible onOpenChange={setIsOpen} open={isOpen}>
      <div className="flex items-center gap-2 border-t pt-2">
        <CollapsibleTrigger asChild>
          <Button
            className="h-7 flex-1 justify-start gap-2 px-2 text-muted-foreground text-xs"
            variant="ghost"
          >
            <ChevronRightIcon
              className={`size-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
            <LinkIcon className="size-3" />
            Or paste a URL directly
          </Button>
        </CollapsibleTrigger>
        {onCancel && (
          <Button
            className="h-7 shrink-0 text-xs"
            onClick={onCancel}
            size="sm"
            variant="outline"
          >
            Cancel
          </Button>
        )}
      </div>

      <CollapsibleContent className="pt-2">
        <form className="space-y-2" onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <Input
              className="h-8 flex-1 text-xs"
              disabled={isPending}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              onPaste={handlePaste}
              placeholder="https://..."
              type="url"
              value={url}
            />
            <Button
              className="h-8 shrink-0"
              disabled={isPending || !url.trim()}
              size="sm"
              type="submit"
            >
              {isPending ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                "Load"
              )}
            </Button>
          </div>

          {detectedPlatform && (
            <p className="text-primary text-xs">
              Detected: {platformLabels[detectedPlatform] ?? detectedPlatform}
            </p>
          )}

          {!!error?.trim() && (
            <p className="text-destructive text-xs">{error}</p>
          )}

          <div className="space-y-1 text-[10px] text-muted-foreground/70">
            <p className="font-medium">Supported URL patterns:</p>
            <ul className="list-inside list-disc space-y-0.5 pl-1">
              <li>
                <span className="font-medium" style={{ color: "#629aa0" }}>
                  Bandcamp
                </span>
                : albums, tracks, artist pages, collections
              </li>
              <li>
                <span className="font-medium" style={{ color: "#ff7700" }}>
                  SoundCloud
                </span>
                : tracks, playlists, user profiles
              </li>
              <li>
                <span className="font-medium" style={{ color: "#ff0000" }}>
                  YouTube
                </span>
                : videos, playlists, YouTube Music
              </li>
              <li>
                <span className="font-medium" style={{ color: "#8b5cf6" }}>
                  Direct
                </span>
                : .mp3, .m3u, .pls audio files
              </li>
            </ul>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
