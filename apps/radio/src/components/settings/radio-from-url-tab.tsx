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
// biome-ignore lint/performance/noNamespaceImport: namespace import required for Sentry
import * as Sentry from "@sentry/tanstackstart-react";
import { CheckCircleIcon, LinkIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { radiosCollection } from "@/lib/collections";
import { addRadio } from "@/lib/hooks/use-radios";
import type { RadioMetadata, ScrapedOption } from "@/lib/platform-types";
import { scrapeRadioMetadata } from "@/lib/radio-scraper";
import { RadioFieldPreview } from "./radio-field-preview";

type RadioFromUrlTabProps = {
  onSuccess: () => void;
};

function getBestValue(options?: ScrapedOption[]): string {
  if (!options || options.length === 0) {
    return "";
  }
  return options[0]?.value ?? "";
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
    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }

    try {
      new URL(url);
    } catch {
      setError("Please enter a valid URL");
      return;
    }

    setIsLoading(true);
    setError(null);
    setScrapedData(null);

    try {
      const data = await scrapeRadioMetadata(url);
      setScrapedData(data);
      setName(getBestValue(data.name));
      setStreamUrl(getBestValue(data.streamUrl));
      setLogoUrl(getBestValue(data.logoUrl));
      setDescription(getBestValue(data.description));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = () => {
    if (!(name.trim() && streamUrl.trim())) {
      toast.error("Name and Stream URL are required");
      return;
    }

    setIsAdding(true);
    try {
      const existingRadios = Array.from(radiosCollection.state.values());
      const maxOrder = Math.max(...existingRadios.map((r) => r.order || 0), 0);

      addRadio({
        name: name.trim(),
        streamUrl: streamUrl.trim(),
        logoUrl: logoUrl.trim() || undefined,
        description: description.trim() || undefined,
        websiteUrl: url.trim() || undefined,
        order: maxOrder + 1,
        enabled: true,
        isSystem: false,
      });

      toast.success(`Added "${name.trim()}" to your collection`);
      onSuccess();
    } catch (error) {
      Sentry.captureException(error);
      toast.error(
        error instanceof Error ? error.message : "Failed to add station"
      );
    } finally {
      setIsAdding(false);
    }
  };

  const hasMultipleStreams =
    scrapedData?.streamUrl && scrapedData.streamUrl.length > 1;

  return (
    <div className="space-y-4">
      {/* URL Input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <LinkIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            disabled={isLoading}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="https://example-radio.com"
            value={url}
          />
        </div>
        <Button disabled={isLoading || !url.trim()} onClick={handleFetch}>
          {isLoading ? (
            <>
              <Spinner className="mr-2 size-4" />
              Fetching...
            </>
          ) : (
            "Fetch"
          )}
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      {isLoading && (
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
      )}

      {/* Scraped Results */}
      {scrapedData && (
        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-3">
            {/* Name */}
            <div className="space-y-1.5">
              <label
                className="flex items-center gap-2 font-medium text-sm"
                htmlFor="url-name"
              >
                Station Name
                {scrapedData.name && scrapedData.name.length > 0 && (
                  <span className="flex items-center gap-1 text-primary text-xs">
                    <CheckCircleIcon className="size-3" />
                    Found
                  </span>
                )}
              </label>
              <Input
                id="url-name"
                onChange={(e) => setName(e.target.value)}
                placeholder="Radio station name"
                value={name}
              />
            </div>

            {/* Stream URL */}
            <div className="space-y-1.5">
              <label
                className="flex items-center gap-2 font-medium text-sm"
                htmlFor="url-stream"
              >
                Stream URL
                {scrapedData.streamUrl && scrapedData.streamUrl.length > 0 && (
                  <span className="flex items-center gap-1 text-primary text-xs">
                    <CheckCircleIcon className="size-3" />
                    Found{" "}
                    {scrapedData.streamUrl.length > 1
                      ? `(${scrapedData.streamUrl.length} options)`
                      : ""}
                  </span>
                )}
              </label>
              {hasMultipleStreams ? (
                <Select onValueChange={setStreamUrl} value={streamUrl}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a stream URL" />
                  </SelectTrigger>
                  <SelectContent>
                    {scrapedData.streamUrl?.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label || opt.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="url-stream"
                  onChange={(e) => setStreamUrl(e.target.value)}
                  placeholder="https://stream.example.com/live.mp3"
                  value={streamUrl}
                />
              )}
            </div>

            {/* Logo URL */}
            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="url-logo">
                Logo URL
              </label>
              <Input
                id="url-logo"
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                value={logoUrl}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="url-description">
                Description
              </label>
              <Input
                id="url-description"
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Radio station description"
                value={description}
              />
            </div>
          </div>

          {/* Previews */}
          <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
            {logoUrl && (
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
            )}
            {streamUrl && (
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
            )}
          </div>

          {/* Missing fields warning */}
          {scrapedData.missingFields.length > 0 && (
            <div className="border-t pt-3">
              <p className="text-amber-600 text-xs">
                Could not auto-detect: {scrapedData.missingFields.join(", ")}
              </p>
            </div>
          )}

          <Button
            className="w-full"
            disabled={isAdding || !name.trim() || !streamUrl.trim()}
            onClick={handleAdd}
          >
            {isAdding ? "Adding..." : "Add to Collection"}
          </Button>
        </div>
      )}
    </div>
  );
}
