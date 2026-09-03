/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@avoid.quest/ui/components/dialog";
import { cn } from "@avoid.quest/ui/lib/utils";
import { ArrowUpRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Radio } from "@/lib/audio";
import type { RadioNowPlaying as RadioNowPlayingMetadata } from "@/lib/metadata/types";
import { RadioLogo } from "./radio-logo";

type RadioNowPlayingProps = {
  radio: Radio;
  metadata?: RadioNowPlayingMetadata | null;
  isPlaying: boolean;
  isLoading?: boolean;
  variant?: "featured" | "compact";
  className?: string;
  actions?: ReactNode;
};

function Artwork({
  radio,
  metadata,
  className,
}: Pick<RadioNowPlayingProps, "radio" | "metadata" | "className">) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const artworkUrl = metadata?.artworkUrl;
  const handleError = () => setFailedUrl(artworkUrl ?? null);

  if (!artworkUrl || artworkUrl === failedUrl) {
    return (
      <RadioLogo
        className={cn("shrink-0", className)}
        key={radio.logoUrl}
        logoUrl={radio.logoUrl}
        name={radio.name}
        size="lg"
      />
    );
  }

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError provides the station artwork fallback.
    <img
      alt={`${metadata.title || radio.name} artwork`}
      className={cn("shrink-0 bg-muted object-cover", className)}
      height={384}
      onError={handleError}
      src={artworkUrl}
      width={384}
    />
  );
}

function getIdentity(
  radio: Radio,
  metadata: RadioNowPlayingMetadata | null | undefined
) {
  const title = metadata?.title || metadata?.artist || radio.name;
  const hasNowPlaying = Boolean(metadata?.title || metadata?.artist);
  const artist =
    metadata?.title && metadata.artist !== metadata.title
      ? metadata.artist
      : null;
  const location = [radio.placeTitle, radio.countryTitle]
    .filter(Boolean)
    .join(", ");
  const subtitle = artist || (hasNowPlaying ? null : location || null);
  return { hasNowPlaying, subtitle, title };
}

export function RadioNowPlaying({
  radio,
  metadata,
  isPlaying,
  isLoading = false,
  variant = "compact",
  className,
  actions,
}: RadioNowPlayingProps) {
  const featured = variant === "featured";
  const identity = getIdentity(radio, metadata);
  const { hasNowPlaying, subtitle, title } = identity;
  const playbackStatus = isPlaying ? "Now playing" : "Ready";
  const status = isLoading ? "Connecting" : playbackStatus;
  const fallbackLabel = featured ? "Radio" : status;
  const sourceLabel = hasNowPlaying ? radio.name : fallbackLabel;
  const Heading = featured ? "h2" : "h3";
  const detailsTrigger = (
    <DialogTrigger asChild>
      <button
        aria-label={`Details for ${title}`}
        className="shrink-0 rounded px-1 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
      >
        Details
      </button>
    </DialogTrigger>
  );
  const detailActions = (
    <div className="flex shrink-0 items-center gap-2">
      {detailsTrigger}
      {actions}
    </div>
  );

  return (
    <Dialog>
      <section
        aria-label={`${radio.name} now playing`}
        className={cn("min-w-0", featured && "space-y-4", className)}
      >
        {featured ? (
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
              <span
                className={cn(
                  "size-1.5 rounded-full bg-muted-foreground/40",
                  isPlaying && !isLoading && "bg-emerald-500"
                )}
              />
              {status}
            </p>
            {detailActions}
          </div>
        ) : null}
        <div
          className={cn(
            "flex min-w-0 items-center gap-3",
            !featured && "min-h-18",
            featured && "gap-5 lg:flex-col lg:items-start lg:gap-6"
          )}
        >
          <Artwork
            className={
              featured
                ? "size-24 rounded-xl lg:size-48 lg:rounded-2xl"
                : "size-12 rounded-md"
            }
            metadata={metadata}
            radio={radio}
          />
          <div className="min-w-0 flex-1 lg:w-full">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="truncate font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
                {sourceLabel}
              </p>
              {!featured && detailActions}
            </div>
            <Heading
              className={cn(
                "min-w-0 font-semibold text-sm leading-snug",
                featured &&
                  "mt-1.5 text-xl leading-tight tracking-tight lg:text-3xl"
              )}
            >
              {metadata?.itemUrl ? (
                <a
                  className="group flex min-w-0 items-start gap-1 rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={metadata.itemUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={title}
                >
                  <span className={featured ? "line-clamp-3" : "truncate"}>
                    {title}
                  </span>
                  <ArrowUpRightIcon
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                  />
                </a>
              ) : (
                <span
                  className={featured ? "line-clamp-3" : "block truncate"}
                  title={title}
                >
                  {title}
                </span>
              )}
            </Heading>
            {subtitle ? (
              <p
                className={cn(
                  "mt-0.5 truncate text-muted-foreground text-xs",
                  featured && "mt-2 text-sm lg:text-base"
                )}
                title={subtitle}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
      </section>
      <NowPlayingDetails
        identity={identity}
        metadata={metadata}
        radio={radio}
      />
    </Dialog>
  );
}

function NowPlayingDetails({
  radio,
  metadata,
  identity: { title, subtitle, hasNowPlaying },
}: Pick<RadioNowPlayingProps, "radio" | "metadata"> & {
  identity: ReturnType<typeof getIdentity>;
}) {
  const description = metadata?.stationDescription || radio.description;
  return (
    <DialogContent className="gap-0 overflow-y-auto p-0 sm:max-w-xl">
      <div className="space-y-5 p-6 sm:p-8">
        <DialogDescription className="pr-8 font-medium text-xs uppercase tracking-wider">
          {hasNowPlaying ? radio.name : "Station details"}
        </DialogDescription>
        <Artwork
          className="size-40 rounded-xl sm:size-48"
          metadata={metadata}
          radio={radio}
        />
        <div className="space-y-2">
          <DialogTitle className="break-words text-2xl leading-tight tracking-tight">
            {title}
          </DialogTitle>
          {subtitle ? (
            <p className="text-base text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {metadata?.album || metadata?.genre ? (
          <dl className="grid gap-4 border-border/50 border-y py-4 text-sm sm:grid-cols-2">
            {metadata.album ? (
              <div className="space-y-1">
                <dt className="text-muted-foreground text-xs">
                  Album / series
                </dt>
                <dd className="break-words">{metadata.album}</dd>
              </div>
            ) : null}
            {metadata.genre ? (
              <div className="space-y-1">
                <dt className="text-muted-foreground text-xs">Genre</dt>
                <dd className="break-words">{metadata.genre}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {description ? (
          <div className="space-y-2">
            <h3 className="font-medium text-sm">
              {metadata?.stationDescription ? "About" : "About the station"}
            </h3>
            <p className="whitespace-pre-line break-words text-muted-foreground text-sm leading-relaxed">
              {description}
            </p>
          </div>
        ) : null}
        {metadata?.itemUrl ? (
          <a
            className="inline-flex items-center gap-1 rounded font-medium text-sm underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={metadata.itemUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open page <ArrowUpRightIcon className="size-4" />
          </a>
        ) : null}
      </div>
    </DialogContent>
  );
}
