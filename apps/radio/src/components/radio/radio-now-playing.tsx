/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { parseHttpUrl } from "@avoid.quest/platforms/url-policy";
import { Button } from "@avoid.quest/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@avoid.quest/ui/components/dialog";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  InfoIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import type { RadioNowPlaying as RadioNowPlayingMetadata } from "@/lib/metadata/types";
import { GenreBadges } from "./genre-badges";
import { RadioLogo } from "./radio-logo";
import { formatLocation } from "./station-row";

type RadioNowPlayingProps = {
  radio: Radio;
  metadata?: RadioNowPlayingMetadata | null;
  isLoading?: boolean;
  variant?: "featured" | "compact";
  className?: string;
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
        className={cn("shrink-0 [&>svg]:size-1/3", className)}
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

/** Case-insensitive, so "DJ X" and "dj x" count as one name. */
export function sameText(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return (
    Boolean(a && b) &&
    a?.trim().toLocaleLowerCase() === b?.trim().toLocaleLowerCase()
  );
}

function getIdentity(
  radio: Radio,
  metadata: RadioNowPlayingMetadata | null | undefined
) {
  const title = metadata?.title || metadata?.artist || radio.name;
  const hasNowPlaying = Boolean(metadata?.title || metadata?.artist);
  const artist =
    metadata?.title && !sameText(metadata.artist, metadata.title)
      ? metadata.artist
      : null;
  const location = formatLocation(radio.placeTitle, radio.countryTitle);
  const subtitle = artist || (hasNowPlaying ? null : location || null);
  return { hasNowPlaying, location, subtitle, title };
}

export function RadioNowPlayingDetailsButton({
  radio,
  metadata,
  className,
}: Pick<RadioNowPlayingProps, "radio" | "metadata" | "className">) {
  const identity = getIdentity(radio, metadata);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          aria-label={`Details for ${identity.title}`}
          className={cn("size-7 text-muted-foreground", className)}
          size="icon"
          title={`View details for ${identity.title}`}
          variant="ghost"
        >
          <InfoIcon aria-hidden="true" className="size-3.5" />
        </Button>
      </DialogTrigger>
      <NowPlayingDetails
        identity={identity}
        metadata={metadata}
        radio={radio}
      />
    </Dialog>
  );
}

export function RadioNowPlaying({
  radio,
  metadata,
  isLoading = false,
  variant = "compact",
  className,
}: RadioNowPlayingProps) {
  const featured = variant === "featured";
  const identity = getIdentity(radio, metadata);
  const { hasNowPlaying, subtitle, title } = identity;
  const connectionStatus = isLoading ? (
    <p className="text-muted-foreground text-xs" role="status">
      Connecting…
    </p>
  ) : null;
  const Heading = featured ? "h2" : "h3";

  return (
    <Dialog>
      <section
        aria-label={`${radio.name} now playing`}
        className={cn("min-w-0", className)}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-3",
            featured && "sm:gap-4 lg:flex-col lg:items-center lg:gap-6"
          )}
        >
          <div className="relative shrink-0">
            <DialogTrigger asChild>
              <button
                aria-label={`Details for ${title}`}
                className={cn(
                  "block shrink-0 cursor-pointer rounded-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  featured && "rounded-xl lg:rounded-2xl"
                )}
                title={`View details for ${title}`}
                type="button"
              >
                <Artwork
                  className={
                    featured
                      ? "size-20 rounded-xl sm:size-28 lg:size-[clamp(15rem,36vh,22rem)] lg:rounded-2xl"
                      : "size-16 rounded-lg"
                  }
                  metadata={metadata}
                  radio={radio}
                />
              </button>
            </DialogTrigger>
          </div>
          <div
            className={cn(
              "min-w-0 flex-1 lg:w-full",
              featured && "lg:text-center"
            )}
          >
            {hasNowPlaying ? (
              <p
                className={cn(
                  "mb-0.5 truncate text-muted-foreground text-xs",
                  featured && "mb-1.5"
                )}
                dir="auto"
              >
                {radio.name}
              </p>
            ) : null}
            <Heading
              className={cn(
                "min-w-0 font-semibold text-sm leading-snug",
                featured &&
                  "text-lg leading-tight tracking-tight sm:text-xl lg:text-3xl"
              )}
            >
              {metadata?.itemUrl ? (
                <a
                  className={cn(
                    "group flex min-w-0 items-start gap-1 rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    featured && "lg:justify-center"
                  )}
                  href={metadata.itemUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={title}
                >
                  <span
                    className={
                      featured
                        ? "line-clamp-3 [overflow-wrap:anywhere]"
                        : "truncate"
                    }
                    dir="auto"
                  >
                    {title}
                  </span>
                  <ArrowUpRightIcon
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                  />
                </a>
              ) : (
                <span
                  className={
                    featured
                      ? "line-clamp-3 [overflow-wrap:anywhere]"
                      : "block truncate"
                  }
                  dir="auto"
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
                dir="auto"
                title={subtitle}
              >
                {subtitle}
              </p>
            ) : null}
            <GenreBadges
              className={cn("mt-1.5", featured && "mt-3 lg:justify-center")}
              genre={metadata?.genre}
              limit={featured ? 3 : 1}
            />
            {connectionStatus}
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

function StationInformation({
  radio,
  hasNowPlaying,
  location,
}: Pick<RadioNowPlayingProps, "radio"> & {
  hasNowPlaying: boolean;
  location: string;
}) {
  const description = radio.description?.trim();
  const websiteUrl = parseHttpUrl(radio.websiteUrl ?? "")?.href;
  if (!(description || websiteUrl || (hasNowPlaying && location))) {
    return null;
  }

  return (
    <section className="space-y-3 border-border/50 border-t pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="font-medium text-sm">
            {hasNowPlaying ? radio.name : "About the station"}
          </h3>
          {hasNowPlaying && location ? (
            <p className="text-muted-foreground text-xs">{location}</p>
          ) : null}
        </div>
        {websiteUrl ? (
          <a
            className="inline-flex items-center gap-1 rounded-sm text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={websiteUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Station website
            <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
          </a>
        ) : null}
      </div>
      {description ? (
        <p
          className="whitespace-pre-line break-words text-muted-foreground text-sm leading-relaxed"
          dir="auto"
        >
          {description}
        </p>
      ) : null}
    </section>
  );
}

function NowPlayingDetails({
  radio,
  metadata,
  identity: { title, subtitle, hasNowPlaying, location },
}: Pick<RadioNowPlayingProps, "radio" | "metadata"> & {
  identity: ReturnType<typeof getIdentity>;
}) {
  const description = metadata?.stationDescription?.trim();
  const stationDescription = radio.description?.trim();
  const hasSeparateDescription = Boolean(
    description && description !== stationDescription
  );
  const streamInfo = [
    ["Stream", radio.streamUrl],
    ["Format", radio.streamFormat?.toUpperCase()],
    ["Bitrate", metadata?.bitrate ? `${metadata.bitrate} kbps` : null],
    ["Station name", metadata?.stationName],
    ["Original title", metadata?.rawTitle],
    ["Metadata source", metadata?.source],
    ["Metadata URL", metadata?.resolvedUrl],
    [
      "Last checked",
      metadata ? new Date(metadata.sampledAt).toLocaleString() : null,
    ],
  ].filter(([, value]) => value);

  return (
    <DialogContent
      className="gap-0 overflow-hidden p-0 sm:max-w-3xl"
      showCloseButton={false}
    >
      <div className="flex shrink-0 items-center justify-between border-border/50 border-b px-5 py-3 sm:px-8">
        <DialogDescription className="font-medium text-xs">
          {hasNowPlaying ? "Show & station" : "Station details"}
        </DialogDescription>
        <DialogClose asChild>
          <Button
            aria-label="Close"
            className="size-7 text-muted-foreground"
            size="icon"
            variant="ghost"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </Button>
        </DialogClose>
      </div>
      <div className="min-h-0 space-y-6 overflow-y-auto overscroll-contain p-5 sm:space-y-8 sm:p-8">
        <div className="grid min-w-0 items-center gap-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8">
          <Artwork
            className="mx-auto size-56 max-w-full rounded-xl md:size-60"
            metadata={metadata}
            radio={radio}
          />
          <div className="min-w-0 space-y-5 text-center md:text-left">
            <div className="space-y-2">
              {hasNowPlaying ? (
                <p className="text-muted-foreground text-xs">{radio.name}</p>
              ) : null}
              <DialogTitle
                className="break-words text-2xl leading-tight tracking-tight sm:text-3xl"
                dir="auto"
              >
                {title}
              </DialogTitle>
              {subtitle ? (
                <p
                  className="break-words text-base text-muted-foreground"
                  dir="auto"
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
            {metadata?.album ? (
              <dl className="space-y-1 text-sm">
                <dt className="text-muted-foreground text-xs">
                  Album / series
                </dt>
                <dd className="break-words">{metadata.album}</dd>
              </dl>
            ) : null}
            <GenreBadges
              className="justify-center md:justify-start"
              genre={metadata?.genre}
            />
            {metadata?.itemUrl ? (
              <Button asChild className="text-xs" size="sm" variant="outline">
                <a
                  href={metadata.itemUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Open source page
                  <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
        {hasSeparateDescription ? (
          <section className="space-y-2">
            <h3 className="font-medium text-sm">Description</h3>
            <p
              className="whitespace-pre-line break-words text-muted-foreground text-sm leading-relaxed"
              dir="auto"
            >
              {description}
            </p>
          </section>
        ) : null}
        <StationInformation
          hasNowPlaying={hasNowPlaying}
          location={location}
          radio={radio}
        />
        <details className="group border-border/50 border-t pt-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-muted-foreground text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            Stream information
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-180"
            />
          </summary>
          <dl className="mt-4 space-y-3 text-xs">
            {streamInfo.map(([label, value]) => (
              <div
                className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4"
                key={label}
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words leading-relaxed [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </DialogContent>
  );
}
