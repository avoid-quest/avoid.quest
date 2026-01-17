import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Loader2Icon, MusicIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import { detectPlatformFromUrl } from "@/lib/external-url/detect";
import {
  getUrlExample,
  getUrlPlaceholder,
} from "@/lib/external-url/metadata-helpers";
import { usePlatformLoad } from "@/lib/hooks/use-platform-query";
import type { Platform } from "@/lib/platform-types";

type PlatformFormProps = {
  onLoad: (radio: Radio) => void;
  onCancel?: () => void;
  initialPlatform?: Platform;
  editMode?: boolean;
  currentUrl?: string;
};

export function PlatformForm({
  onLoad,
  onCancel,
  initialPlatform,
  editMode = false,
  currentUrl,
}: PlatformFormProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(
    initialPlatform || "bandcamp"
  );
  const [url, setUrl] = useState(currentUrl || "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const detectedPlatform = detectPlatformFromUrl(url);

  // Use TanStack Query mutation for loading platform items
  const { mutate: loadItem, isPending: isLoading } = usePlatformLoad({
    onSuccess: (radio) => {
      onLoad(radio);
      // Reset form after successful load
      if (!editMode) {
        setUrl("");
      }
      setError(null);
    },
    onError: (errorMessage) => {
      setError(errorMessage);
    },
  });

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }

    setError(null);
    loadItem(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <MusicIcon className="size-5" />
          <h3 className="font-medium text-sm">
            {editMode ? "Change URL" : "Add Platform Item"}
          </h3>
        </div>

        {!initialPlatform && (
          <Tabs
            className="w-full"
            onValueChange={(value) => setSelectedPlatform(value as Platform)}
            value={selectedPlatform}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="bandcamp">Bandcamp</TabsTrigger>
              <TabsTrigger value="soundcloud">SoundCloud</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

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
                if (
                  pastedText?.valueOf()?.trim() !== "" &&
                  detectPlatformFromUrl(pastedText)
                ) {
                  e.preventDefault();
                  setUrl(pastedText.trim());
                  setError(null);
                  const platform = detectPlatformFromUrl(pastedText);
                  if (platform) {
                    setSelectedPlatform(platform);
                  }
                }
              }}
              placeholder={getUrlPlaceholder(selectedPlatform)}
              ref={inputRef}
              type="url"
              value={url}
            />
            <p className="text-muted-foreground text-xs">
              {getUrlExample(selectedPlatform)}
            </p>
            {detectedPlatform?.valueOf() && (
              <p className="text-primary text-xs">
                Detected:{" "}
                {detectedPlatform === "bandcamp" ? "Bandcamp" : "SoundCloud"}
              </p>
            )}
          </div>

          {!!error?.trim() && (
            <div className="rounded-md bg-destructive/10 p-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-2">
            {onCancel?.valueOf() && (
              <Button
                className="flex-1"
                onClick={onCancel}
                type="button"
                variant="outline"
              >
                Eject
              </Button>
            )}
            <Button
              className="flex-1"
              disabled={isLoading || !url.trim()}
              type="submit"
            >
              {isLoading.valueOf() && (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              )}
              {editMode ? "Update" : "Load"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
