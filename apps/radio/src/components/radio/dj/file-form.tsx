import { Button } from "@avoid.quest/ui/components/button";
import { FileAudioIcon, Loader2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { isAudioFile } from "@/lib/audio/file-metadata";

type FileFormProps = {
  onLoad: (file: File) => void;
  onCancel?: () => void;
};

export function FileForm({ onLoad, onCancel }: FileFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <FileAudioIcon className="size-5" />
          <h3 className="font-medium text-sm">Load Audio File</h3>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-center text-destructive text-sm">{error}</p>
          </div>
        )}

        <div className="space-y-2">
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
        </div>

        <div className="flex gap-2">
          {onCancel && (
            <Button
              className="flex-1"
              disabled={isLoading}
              onClick={onCancel}
              variant="outline"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
