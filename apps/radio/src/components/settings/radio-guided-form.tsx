import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Spinner } from "@workspace/ui/components/spinner";
import { useState } from "react";
import { scrapeRadioMetadata } from "@/lib/radio-scraper";
import type { RadioMetadata } from "@/lib/types";

type RadioGuidedFormProps = {
  onScrapedData: (data: RadioMetadata) => void;
  onError: (error: string) => void;
};

export function RadioGuidedForm({
  onScrapedData,
  onError,
}: RadioGuidedFormProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleFetch = async () => {
    if (!url.trim()) {
      onError("Please enter a website URL");
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      onError("Please enter a valid URL (e.g., https://example.com)");
      return;
    }

    setIsLoading(true);
    try {
      const data = await scrapeRadioMetadata(url);
      onScrapedData(data);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch website data";
      onError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="website-url">Radio Station Website URL</Label>
        <Input
          disabled={isLoading}
          id="website-url"
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example-radio.com"
          type="url"
          value={url}
        />
        <p className="text-muted-foreground text-xs">
          Enter the main website URL of the radio station. We'll automatically
          find the stream URL, logo, and other details.
        </p>
      </div>

      <Button
        className="w-full"
        disabled={isLoading || !url.trim()}
        onClick={handleFetch}
      >
        {isLoading ? (
          <>
            <Spinner className="mr-2 size-4" />
            Fetching radio info...
          </>
        ) : (
          "Fetch Radio Info"
        )}
      </Button>

      {isLoading && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Analyzing the website to find radio information...
          </p>
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
        </div>
      )}
    </div>
  );
}
