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
import { FileAudioIcon, FolderOpenIcon, GlobeIcon } from "lucide-react";
import { useRef, useState } from "react";
import { isAudioFile } from "@/lib/audio/file-metadata";
import { isStaticAudioUrl } from "@/lib/audio/remote-url";
import { InlineError } from "../inline-error";
import { describeFileLoadFailure } from "./file-load-failure";

/** Resolves to why the load failed, or null once the source is on the deck. */
type LoadFile<T> = (source: T) => Promise<string | null>;

type FileFormProps = {
  onLoad: LoadFile<File>;
  onLoadUrl?: LoadFile<string>;
  onLoadFiles?: LoadFile<readonly File[]>;
  onCancel?: () => void;
};

export function FileForm({
  onLoad,
  onLoadUrl,
  onLoadFiles,
  onCancel,
}: FileFormProps) {
  const [activeTab, setActiveTab] = useState<"file" | "url">("file");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // The form stays up while the deck loads; a failure lands here, next to
  // what the user picked or typed.
  const load = (loading: Promise<string | null>) => {
    setError(null);
    setIsLoading(true);
    loading
      .then((failure) => {
        if (failure) {
          setError(describeFileLoadFailure(failure));
        }
      })
      .catch((cause: unknown) => {
        setError(
          describeFileLoadFailure(
            cause instanceof Error ? cause.message : String(cause)
          )
        );
      })
      .finally(() => setIsLoading(false));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const [file] = files;
    // Let the same file be picked again after a failed load.
    event.target.value = "";
    if (!file) {
      return;
    }

    if (!isAudioFile(file)) {
      setError("Unsupported audio format");
      return;
    }

    load(files.length > 1 && onLoadFiles ? onLoadFiles(files) : onLoad(file));
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

    if (onLoadUrl) {
      load(onLoadUrl(trimmed));
    }
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
            multiple={!!onLoadFiles}
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
          {onLoadFiles ? (
            <>
              <input
                className="hidden"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length) {
                    load(onLoadFiles(files));
                  }
                }}
                ref={(element) => {
                  folderRef.current = element;
                  if (element) {
                    element.webkitdirectory = true;
                  }
                }}
                type="file"
              />
              <Button
                className="h-7 w-full text-xs"
                disabled={isLoading}
                onClick={() => folderRef.current?.click()}
                size="sm"
                variant="outline"
              >
                <FolderOpenIcon /> Browse folder
              </Button>
              <p className="text-center text-muted-foreground text-xs">
                Includes subfolders. Playable files become a playlist in
                filename order. Pick again after reloading.
              </p>
            </>
          ) : null}
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
