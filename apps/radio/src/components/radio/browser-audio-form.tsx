// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { isPublicHttpUrl } from "@avoid.quest/platforms/url-policy";
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { ExternalLinkIcon, MonitorIcon } from "lucide-react";
import { useState } from "react";
import {
  BROWSER_AUDIO_SOURCES,
  type BrowserAudioSource,
} from "@/lib/audio/playback/display-audio";
import { radios } from "@/lib/const";
import { InlineError } from "./inline-error";

export function BrowserAudioHelp({
  url = "",
  onUrlChange,
  showRadios = false,
}: {
  url?: string;
  onUrlChange?: (url: string) => void;
  showRadios?: boolean;
}) {
  const [link, setLink] = useState(url);
  const valid =
    isPublicHttpUrl(link.trim()) &&
    !new URL(link.trim()).username &&
    !new URL(link.trim()).password;
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        Play the source in another tab. Choose that tab and enable Share tab
        audio. Control tracks, shows and seeking in the source tab.
      </p>
      <Input
        aria-label="Source page URL"
        className="h-8"
        onChange={(event) => {
          setLink(event.target.value);
          onUrlChange?.(event.target.value.trim());
        }}
        placeholder="Paste a Spotify, Mixcloud or radio show link"
        value={link}
      />
      <Button
        asChild
        className="h-7 w-full text-xs"
        size="sm"
        variant="outline"
      >
        <a
          aria-disabled={!valid}
          href={valid ? link.trim() : undefined}
          onClick={(event) => {
            if (!valid) {
              event.preventDefault();
              return;
            }
            onUrlChange?.(link.trim());
          }}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLinkIcon />
          Open source tab
        </a>
      </Button>
      {showRadios ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            Browse supported radio archives
          </summary>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2">
            {radios
              .filter(
                (radio) => radio.websiteUrl && !radio.name.includes("Channel 2")
              )
              .map((radio) => (
                <a
                  className="underline underline-offset-2"
                  href={radio.websiteUrl}
                  key={radio.name}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {radio.name}
                </a>
              ))}
          </div>
        </details>
      ) : null}
      <p className="text-muted-foreground">
        Desktop Chrome / Edge recommended. Only a tab's audio can be shared, so
        the mixer never captures itself; route desktop apps through a virtual
        audio input instead. Protected content may be silent.
      </p>
    </div>
  );
}

export function BrowserAudioForm({
  source,
  onLoad,
  onCancel,
}: {
  source: BrowserAudioSource;
  onLoad: (sourceUrl: string, label: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const definition =
    BROWSER_AUDIO_SOURCES.find((entry) => entry.id === source) ??
    BROWSER_AUDIO_SOURCES[0];
  const [url, setUrl] = useState(definition.url as string);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3 overflow-y-auto py-2">
      <p className="font-medium text-sm">{definition.name}</p>
      <BrowserAudioHelp
        onUrlChange={setUrl}
        showRadios={source === "radio-shows"}
        url={url}
      />
      {error ? <InlineError>{error}</InlineError> : null}
      <Button
        className="h-8 w-full text-xs"
        disabled={loading}
        onClick={() => {
          setError(null);
          setLoading(true);
          onLoad(url, definition.name)
            .catch((cause: unknown) =>
              setError(
                cause instanceof Error ? cause.message : "Could not share audio"
              )
            )
            .finally(() => setLoading(false));
        }}
        size="sm"
      >
        {loading ? <Spinner /> : <MonitorIcon />}Share tab audio
      </Button>
      {onCancel ? (
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
