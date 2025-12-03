import { ImageIcon, Volume2Icon } from "lucide-react";
import { useState } from "react";
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
  const [audioError, setAudioError] = useState(false);

  if (!value) {
    return null;
  }

  const handleAudioError = () => {
    setAudioError(true);
  };

  const renderPreview = () => {
    switch (field) {
      case "logoUrl":
        return (
          <div className="flex items-center justify-center rounded bg-muted p-2">
            <RadioLogo
              fallbackIcon={
                <ImageIcon className="size-4 text-muted-foreground" />
              }
              logoUrl={value}
              name={radioName}
              size="md"
            />
          </div>
        );

      case "streamUrl":
        return (
          <div className="space-y-1">
            {audioError ? (
              <div className="flex items-center justify-center rounded border border-destructive/20 bg-destructive/10 p-2">
                <div className="text-center">
                  <Volume2Icon className="mx-auto mb-1 size-4 text-destructive" />
                  <p className="text-destructive text-xs">Failed to load</p>
                </div>
              </div>
            ) : (
              <div className="rounded bg-muted p-1">
                <audio
                  className="h-8 w-full"
                  controls
                  onError={handleAudioError}
                  preload="metadata"
                  src={value}
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
            <div className="rounded bg-muted p-2">
              <a
                className="break-all text-primary text-xs hover:underline"
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
