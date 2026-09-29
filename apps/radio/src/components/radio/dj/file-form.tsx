// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { FileAudioIcon, GlobeIcon } from "lucide-react";
import { useRef, useState } from "react";
import { isAudioFile } from "@/lib/audio/file-metadata";
import { isStaticAudioUrl } from "@/lib/audio/remote-url";
import { InlineError } from "../inline-error";

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
      setError("Enter a URL");
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
      setError("Enter a full URL, starting with https://");
      return;
    }

    // Validate it's an audio URL
    if (!isStaticAudioUrl(trimmed)) {
      setError(
        "Link to an audio file (.mp3, .wav…) or a playlist (.m3u, .pls)"
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
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-2">
      {error ? <InlineError>{error}</InlineError> : null}

      <Tabs onValueChange={handleTabChange} value={activeTab}>
        <TabsList className="w-full">
          <TabsTrigger className="text-xs" value="file">
            <FileAudioIcon />
            Local file
          </TabsTrigger>
          <TabsTrigger className="text-xs" value="url">
            <GlobeIcon />
            Remote URL
          </TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-2" tabIndex={-1} value="file">
          <input
            accept="audio/*"
            className="hidden"
            onChange={handleFileChange}
            ref={inputRef}
            type="file"
          />
          <Button
            className="h-7 w-full text-xs"
            disabled={isLoading}
            onClick={handleBrowse}
            size="sm"
            variant="outline"
          >
            {isLoading ? <Spinner /> : <FileAudioIcon />}
            {isLoading ? "Loading…" : "Browse files"}
          </Button>
          <p className="text-center text-muted-foreground text-xs">
            MP3, WAV, FLAC, OGG, AAC, M4A, WebM
          </p>
        </TabsContent>

        <TabsContent className="space-y-2" tabIndex={-1} value="url">
          <Input
            aria-label="Audio file URL"
            className="h-8"
            disabled={isLoading}
            onChange={handleUrlChange}
            onKeyDown={handleKeyDown}
            placeholder="https://example.com/track.mp3"
            value={urlInput}
          />
          <Button
            className="h-7 w-full text-xs"
            disabled={isLoading || !urlInput.trim()}
            onClick={handleUrlSubmit}
            size="sm"
            variant="outline"
          >
            {isLoading ? <Spinner /> : <GlobeIcon />}
            {isLoading ? "Loading…" : "Load URL"}
          </Button>
          <p className="text-center text-muted-foreground text-xs">
            MP3, WAV, OGG, FLAC, M4A + M3U/PLS playlists
          </p>
        </TabsContent>
      </Tabs>

      {onCancel ? (
        <div className="mt-auto flex justify-end border-border/50 border-t pt-2">
          <Button
            className="h-7 text-xs"
            disabled={isLoading}
            onClick={onCancel}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
