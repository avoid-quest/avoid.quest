// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { ImageIcon, Volume2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { RadioLogo } from "../radio/radio-logo";

type RadioFieldPreviewProps = {
  field: "logoUrl" | "streamUrl" | "websiteUrl";
  value: string;
  radioName: string;
};

export function RadioFieldPreview({
  field,
  value,
  radioName,
}: RadioFieldPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setPreviewUrl(value), 300);
    return () => clearTimeout(timeout);
  }, [value]);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const audioError = failedUrl === previewUrl;
  const handleAudioError = () => {
    setFailedUrl(previewUrl);
  };

  if (!(value && previewUrl)) {
    return null;
  }

  const renderPreview = () => {
    switch (field) {
      case "logoUrl":
        return (
          <div className="flex items-center justify-center bg-muted p-2">
            <RadioLogo
              fallbackIcon={
                <ImageIcon className="size-4 text-muted-foreground" />
              }
              logoUrl={previewUrl}
              name={radioName}
              size="md"
            />
          </div>
        );

      case "streamUrl":
        return (
          <div className="space-y-1">
            {audioError ? (
              <div className="flex items-center justify-center border border-destructive/20 bg-destructive/10 p-2">
                <div className="text-center">
                  <Volume2Icon className="mx-auto mb-1 size-4 text-destructive" />
                  <p className="text-destructive text-xs">Couldn't load</p>
                </div>
              </div>
            ) : (
              <div className="bg-muted p-1">
                <audio
                  className="h-8 w-full"
                  controls
                  onError={handleAudioError}
                  preload="metadata"
                  src={previewUrl}
                >
                  <track kind="captions" />
                  Your browser does not support the audio element.
                </audio>
              </div>
            )}
          </div>
        );

      case "websiteUrl":
        return (
          <div className="space-y-1">
            <div className="bg-muted p-2">
              <a
                className="break-all text-primary text-xs outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                href={value}
                rel="noopener noreferrer"
                target="_blank"
              >
                {value}
              </a>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return renderPreview();
}
