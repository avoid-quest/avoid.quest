// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { FileAudioIcon, GlobeIcon, Loader2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { isAudioFile } from "@/lib/audio/file-metadata";
import { isStaticAudioUrl } from "@/lib/audio/remote-url";

type FileFormProps = {
  onLoad: (file: File) => void;
  onLoadUrl?: (url: string) => void;
  onCancel?: () => void;
};

export function FileForm({ onLoad, onLoadUrl, onCancel }: FileFormProps) {
  const [activeTab, setActiveTab] = useState<"file" | "url">("file");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!isAudioFile(file)) {
      setError("Unsupported audio format");
      return;
    }

    setError(null);
    setIsLoading(true);
    onLoad(file);
  };

  const handleBrowse = () => {
    inputRef.current?.click();
  };

  const handleUrlSubmit = () => {
    const trimmed = urlInput.trim();

    if (!trimmed) {
      setError("Please enter a URL");
      return;
    }

    // Validate URL format
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setError("URL must start with http:// or https://");
        return;
      }
    } catch {
      setError("Invalid URL format");
      return;
    }

    // Validate it's an audio URL
    if (!isStaticAudioUrl(trimmed)) {
      setError(
        "URL must point to an audio file (.mp3, .wav, etc.) or playlist (.m3u, .pls)"
      );
      return;
    }

    setError(null);
    setIsLoading(true);
    onLoadUrl?.(trimmed);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !isLoading) {
      handleUrlSubmit();
    }
  };
  const handleTabChange = (value: string) => {
    setActiveTab(value as "file" | "url");
    setError(null);
  };
  const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    setUrlInput(event.target.value);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <FileAudioIcon className="size-5" />
          <h3 className="font-medium text-sm">Load Audio</h3>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-center text-destructive text-sm">{error}</p>
          </div>
        ) : null}

        <Tabs onValueChange={handleTabChange} value={activeTab}>
          <TabsList className="w-full">
            <TabsTrigger className="flex-1" value="file">
              <FileAudioIcon className="mr-2 size-4" />
              Local File
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="url">
              <GlobeIcon className="mr-2 size-4" />
              Remote URL
            </TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4 space-y-2" value="file">
            <input
              accept="audio/*"
              className="hidden"
              onChange={handleFileChange}
              ref={inputRef}
              type="file"
            />
            <Button
              className="w-full"
              disabled={isLoading}
              onClick={handleBrowse}
              variant="outline"
            >
              {isLoading ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <FileAudioIcon className="mr-2 size-4" />
              )}
              {isLoading ? "Loading..." : "Browse Files"}
            </Button>
            <p className="text-center text-muted-foreground text-xs">
              MP3, WAV, FLAC, OGG, AAC, M4A, WebM
            </p>
          </TabsContent>

          <TabsContent className="mt-4 space-y-2" value="url">
            <Input
              disabled={isLoading}
              onChange={handleUrlChange}
              onKeyDown={handleKeyDown}
              placeholder="https://example.com/track.mp3"
              value={urlInput}
            />
            <Button
              className="w-full"
              disabled={isLoading || !urlInput.trim()}
              onClick={handleUrlSubmit}
              variant="outline"
            >
              {isLoading ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <GlobeIcon className="mr-2 size-4" />
              )}
              {isLoading ? "Loading..." : "Load URL"}
            </Button>
            <p className="text-center text-muted-foreground text-xs">
              MP3, WAV, OGG, FLAC, M4A + M3U/PLS playlists
            </p>
          </TabsContent>
        </Tabs>

        <div className="flex gap-2">
          {onCancel ? (
            <Button
              className="flex-1"
              disabled={isLoading}
              onClick={onCancel}
              variant="outline"
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
