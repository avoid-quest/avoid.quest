// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers

import { captureError } from "@avoid.quest/error";
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { CheckCircleIcon, LinkIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { RadioMetadata } from "@/lib/platform-types";
import { stationIntake } from "@/lib/stations/external-station-workflow";
import { createBrowserManualWebsiteImportWorkflow } from "@/lib/stations/manual-website-import-workflow";
import { notifyStationSave } from "@/lib/stations/station-save-notification";
import { InlineError } from "../radio/inline-error";
import { RadioFieldPreview } from "./radio-field-preview";

type RadioFromUrlTabProps = {
  onSuccess: () => void;
};

const createWorkflow = createBrowserManualWebsiteImportWorkflow;

type ScrapedStationEditorProps = {
  data: RadioMetadata;
  description: string;
  hasMultipleStreams: boolean;
  isAdding: boolean;
  logoUrl: string;
  name: string;
  onAdd: () => void;
  onDescriptionChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onLogoUrlChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onStreamUrlChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  setStreamUrl: (value: string) => void;
  streamUrl: string;
};

function ScrapedStationEditor({
  data,
  description,
  hasMultipleStreams,
  isAdding,
  logoUrl,
  name,
  onAdd,
  onDescriptionChange,
  onLogoUrlChange,
  onNameChange,
  onStreamUrlChange,
  setStreamUrl,
  streamUrl,
}: ScrapedStationEditorProps) {
  const streamOptions = data.streamUrl ?? [];

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label
            className="flex items-center gap-2 font-medium text-sm"
            htmlFor="url-name"
          >
            Station Name
            {(data.name?.length ?? 0) > 0 ? (
              <span className="flex items-center gap-1 text-primary text-xs">
                <CheckCircleIcon className="size-3" />
                Found
              </span>
            ) : null}
          </label>
          <Input
            id="url-name"
            onChange={onNameChange}
            placeholder="Radio station name"
            value={name}
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="flex items-center gap-2 font-medium text-sm"
            htmlFor="url-stream"
          >
            Stream URL
            {streamOptions.length > 0 ? (
              <span className="flex items-center gap-1 text-primary text-xs">
                <CheckCircleIcon className="size-3" />
                Found{" "}
                {streamOptions.length > 1
                  ? `(${streamOptions.length} options)`
                  : ""}
              </span>
            ) : null}
          </label>
          {hasMultipleStreams ? (
            <Select onValueChange={setStreamUrl} value={streamUrl}>
              <SelectTrigger>
                <SelectValue placeholder="Select a stream URL" />
              </SelectTrigger>
              <SelectContent>
                {streamOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label || option.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="url-stream"
              onChange={onStreamUrlChange}
              placeholder="https://stream.example.com/live.mp3"
              value={streamUrl}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <label className="font-medium text-sm" htmlFor="url-logo">
            Logo URL
          </label>
          <Input
            id="url-logo"
            onChange={onLogoUrlChange}
            placeholder="https://example.com/logo.png"
            value={logoUrl}
          />
        </div>

        <div className="space-y-1.5">
          <label className="font-medium text-sm" htmlFor="url-description">
            Description
          </label>
          <Input
            id="url-description"
            onChange={onDescriptionChange}
            placeholder="Radio station description"
            value={description}
          />
        </div>
      </div>

      <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
        {logoUrl ? (
          <div className="space-y-1">
            <div className="font-medium text-muted-foreground text-xs">
              Logo Preview
            </div>
            <RadioFieldPreview
              field="logoUrl"
              radioName={name || "Radio"}
              value={logoUrl}
            />
          </div>
        ) : null}
        {streamUrl ? (
          <div className="space-y-1">
            <div className="font-medium text-muted-foreground text-xs">
              Audio Stream Preview
            </div>
            <RadioFieldPreview
              field="streamUrl"
              radioName={name || "Radio"}
              value={streamUrl}
            />
          </div>
        ) : null}
      </div>

      {data.missingFields.length > 0 ? (
        <div className="border-t pt-3">
          <p className="text-amber-600 text-xs">
            Could not auto-detect: {data.missingFields.join(", ")}
          </p>
        </div>
      ) : null}

      <Button
        className="w-full"
        disabled={isAdding || !name.trim() || !streamUrl.trim()}
        onClick={onAdd}
      >
        {isAdding ? "Adding…" : "Add station"}
      </Button>
    </div>
  );
}

export function RadioFromUrlTab({ onSuccess }: RadioFromUrlTabProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrapedData, setScrapedData] = useState<RadioMetadata | null>(null);

  // Editable fields after scrape
  const [name, setName] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleFetch = async () => {
    const workflow = createWorkflow();
    const validatedUrl = workflow.validateWebsiteUrl(url);
    if (!validatedUrl.ok) {
      setError(validatedUrl.error.message);
      return;
    }

    setIsLoading(true);
    setError(null);
    setScrapedData(null);

    try {
      const result = await workflow.fetchDefaults(validatedUrl.data);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setScrapedData(result.data.metadata);
      setName(result.data.fields.name);
      setStreamUrl(result.data.fields.streamUrl);
      setLogoUrl(result.data.fields.logoUrl);
      setDescription(result.data.fields.description);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to fetch data"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!(name.trim() && streamUrl.trim())) {
      toast.error("Name and Stream URL are required");
      return;
    }

    setIsAdding(true);
    try {
      const result = await stationIntake.save({
        fields: {
          description,
          logoUrl,
          name,
          streamUrl,
          websiteUrl: url,
        },
        origin: "website",
      });

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }

      notifyStationSave(
        result.data,
        `Added "${name.trim()}" to your collection`
      );
      onSuccess();
    } catch (saveError) {
      captureError(saveError, {
        operation: "radio-from-url.add",
        surface: "ui",
      });
      toast.error(
        saveError instanceof Error ? saveError.message : "Failed to add station"
      );
    } finally {
      setIsAdding(false);
    }
  };

  const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(event.target.value);
    setError(null);
  };
  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  };
  const handleStreamUrlChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setStreamUrl(event.target.value);
  };
  const handleLogoUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLogoUrl(event.target.value);
  };
  const handleDescriptionChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setDescription(event.target.value);
  };

  const hasMultipleStreams = Boolean(
    scrapedData?.streamUrl && scrapedData.streamUrl.length > 1
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isLoading && url.trim()) {
      handleFetch();
    }
  };

  return (
    <div className="space-y-4">
      {/* URL Input */}
      <form className="flex gap-2" onSubmit={handleSubmit}>
        <div className="relative flex-1">
          <LinkIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            disabled={isLoading}
            onChange={handleUrlChange}
            placeholder="https://example-radio.com"
            value={url}
          />
        </div>
        <Button disabled={isLoading || !url.trim()} type="submit">
          {isLoading ? (
            <>
              <Spinner className="mr-2 size-4" />
              Fetching…
            </>
          ) : (
            "Fetch"
          )}
        </Button>
      </form>

      {error ? <InlineError>{error}</InlineError> : null}

      {isLoading ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <div className="size-2 animate-pulse rounded-full bg-blue-500" />
            Looking for stream URLs
          </div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <div className="size-2 animate-pulse rounded-full bg-blue-500" />
            Finding logos and images
          </div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <div className="size-2 animate-pulse rounded-full bg-blue-500" />
            Extracting station details
          </div>
        </div>
      ) : null}

      {/* Scraped Results */}
      {scrapedData ? (
        <ScrapedStationEditor
          data={scrapedData}
          description={description}
          hasMultipleStreams={hasMultipleStreams}
          isAdding={isAdding}
          logoUrl={logoUrl}
          name={name}
          onAdd={handleAdd}
          onDescriptionChange={handleDescriptionChange}
          onLogoUrlChange={handleLogoUrlChange}
          onNameChange={handleNameChange}
          onStreamUrlChange={handleStreamUrlChange}
          setStreamUrl={setStreamUrl}
          streamUrl={streamUrl}
        />
      ) : null}
    </div>
  );
}
