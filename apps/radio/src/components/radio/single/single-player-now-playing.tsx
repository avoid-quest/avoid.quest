import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Music2Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import type { Radio } from "@/lib/audio";
import { formatNowPlaying } from "@/lib/metadata/display";
import type { RadioNowPlaying as RadioNowPlayingMetadata } from "@/lib/metadata/types";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";
import { RadioNowPlaying } from "../radio-now-playing";

type SharedPanelProps = {
  radio: Radio | null;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  volume: number;
  isMuted: boolean;
  metadata?: RadioNowPlayingMetadata | null;
  onPlayPause: () => void;
  onVolumeChange: (value: number[]) => void;
  onMuteToggle: () => void;
};

export function NowPlayingPanel(props: SharedPanelProps) {
  return <PlayerPanel {...props} mode="desktop" />;
}

type MobilePanelProps = SharedPanelProps & {
  onDelete: (radio: Radio) => void;
  onEdit: (radio: Radio) => void;
  onSave: (radio: Radio) => void;
  onToggle: (radio: Radio, enabled: boolean) => void;
};

export function MobileNowPlayingPanel({
  radio,
  onDelete,
  onEdit,
  onSave,
  onToggle,
  ...playerProps
}: MobilePanelProps) {
  if (!radio) {
    return null;
  }

  return (
    <div className="relative shrink-0 border-border/50 border-b px-5 py-5 lg:hidden">
      <div className="absolute top-3 right-3">
        <RadioItemActions
          onDelete={onDelete}
          onEdit={onEdit}
          onSave={onSave}
          onToggle={onToggle}
          radio={radio}
        />
      </div>
      <PlayerPanel {...playerProps} mode="mobile" radio={radio} />
    </div>
  );
}

function PlayerPanel({
  radio,
  isPlaying,
  isLoading,
  error,
  volume,
  isMuted,
  metadata,
  mode,
  onPlayPause,
  onVolumeChange,
  onMuteToggle,
}: SharedPanelProps & { mode: "desktop" | "mobile" }) {
  if (!radio) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <Music2Icon className="size-12 text-muted-foreground/15" />
        <p className="font-mono text-muted-foreground/40 text-xs uppercase tracking-wider">
          Select a station
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-lg flex-col gap-5",
        mode === "mobile" && "pt-2"
      )}
    >
      <PlayerIdentity metadata={metadata} mode={mode} radio={radio} />

      {radio.description && !radio.placeTitle && (
        <div className="min-w-0 border-border/50 border-t pt-4 text-left">
          <p className="line-clamp-2 text-muted-foreground text-sm leading-relaxed">
            {radio.description}
          </p>
        </div>
      )}

      {!!error?.trim() && (
        <div className="rounded-md bg-destructive/10 px-3 py-1.5">
          <p className="font-mono text-destructive text-xs">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-4 border-border/50 border-t pt-4">
        <PlayPauseButton
          className="size-12 shrink-0"
          disabled={isLoading}
          iconClassName="size-5"
          isLoading={isLoading}
          isPlaying={isPlaying}
          onClick={onPlayPause}
          size="sm"
          variant={isPlaying && !isLoading ? "outline" : "default"}
        />
        <button
          aria-label={isMuted ? "Unmute" : "Mute"}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          onClick={onMuteToggle}
          type="button"
        >
          {isMuted ? (
            <VolumeXIcon className="size-4" />
          ) : (
            <Volume2Icon className="size-4" />
          )}
        </button>
        <Slider
          className="h-2 min-w-0 flex-1"
          defaultValue={[1]}
          max={1}
          min={0}
          onValueChange={onVolumeChange}
          step={0.01}
          value={[volume]}
        />
        <span className="w-9 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </div>
  );
}

function PlayerIdentity({
  radio,
  metadata,
  mode,
}: {
  radio: Radio;
  metadata?: RadioNowPlayingMetadata | null;
  mode: "desktop" | "mobile";
}) {
  return (
    <div className="flex min-w-0 items-center gap-4 pr-7">
      <RadioLogo
        className={cn(
          "shrink-0 rounded-xl",
          mode === "desktop" ? "size-28" : "size-20"
        )}
        logoUrl={radio.logoUrl}
        name={radio.name}
        size={mode === "desktop" ? "3xl" : "xl"}
      />
      <div className="min-w-0 text-left">
        <p className="mb-1 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
          Playing
        </p>
        <p className="min-w-0 truncate font-semibold text-xl">{radio.name}</p>
        <NowPlayingLine metadata={metadata} />
        {radio.placeTitle ? (
          <p className="mt-1 truncate text-muted-foreground text-sm">
            {radio.placeTitle}, {radio.countryTitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function NowPlayingLine({
  metadata,
}: {
  metadata?: RadioNowPlayingMetadata | null;
}) {
  if (!formatNowPlaying(metadata)) {
    return null;
  }
  return (
    <div className="mt-1.5 flex min-w-0 items-center">
      <RadioNowPlaying
        className="min-w-0 max-w-full text-muted-foreground text-xs"
        metadata={metadata}
      />
    </div>
  );
}
