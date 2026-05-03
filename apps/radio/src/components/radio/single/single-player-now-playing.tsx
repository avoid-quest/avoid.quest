import { Badge } from "@avoid.quest/ui/components/badge";
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { Music2Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import type { Radio } from "@/lib/audio";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";

type SharedPanelProps = {
  radio: Radio | null;
  isPlaying: boolean;
  isLoading: boolean;
  isCrossfading: boolean;
  error: string | null;
  volume: number;
  isMuted: boolean;
  onPlayPause: () => void;
  onVolumeChange: (value: number[]) => void;
  onMuteToggle: () => void;
};

export function NowPlayingPanel({
  radio,
  isPlaying,
  isLoading,
  isCrossfading,
  error,
  volume,
  isMuted,
  onPlayPause,
  onVolumeChange,
  onMuteToggle,
}: SharedPanelProps) {
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

  const isSession = isSessionRadio(radio);

  return (
    <div className="relative flex flex-col items-center gap-6">
      <div className="relative size-52 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-black/20 shadow-black/5 shadow-lg">
        <RadioLogo
          className="size-52 rounded-xl"
          logoUrl={radio.logoUrl}
          name={radio.name}
          size="4xl"
        />
        {(isLoading || isCrossfading) && (
          <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
        )}
      </div>

      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-1.5">
          <p className="truncate font-semibold text-lg">{radio.name}</p>
          {isSession && (
            <Badge
              className="h-4 shrink-0 border-[#00d084]/30 bg-[#00d084]/10 px-1 text-[#00d084] text-[10px]"
              variant="outline"
            >
              Unsaved
            </Badge>
          )}
        </div>
        {radio.placeTitle ? (
          <p className="mt-1 text-muted-foreground/60 text-sm leading-relaxed">
            {radio.placeTitle}, {radio.countryTitle}
          </p>
        ) : (
          radio.description && (
            <p className="mt-1 text-muted-foreground/60 text-sm leading-relaxed">
              {radio.description}
            </p>
          )
        )}
      </div>

      {!!error?.trim() && (
        <div className="rounded-md bg-destructive/10 px-3 py-1.5">
          <p className="font-mono text-destructive text-xs">{error}</p>
        </div>
      )}

      <div className="flex w-full max-w-md flex-col items-center gap-5">
        <PlayPauseButton
          className="size-14"
          disabled={isLoading || isCrossfading}
          iconClassName="size-6"
          isLoading={isLoading || isCrossfading}
          isPlaying={isPlaying}
          onClick={onPlayPause}
          size="sm"
          variant={isPlaying && !isLoading ? "outline" : "default"}
        />

        <div className="flex w-full items-center gap-2.5">
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
            className="h-2 flex-1"
            defaultValue={[1]}
            max={1}
            min={0}
            onValueChange={onVolumeChange}
            step={0.01}
            value={[volume]}
          />
          <span className="w-10 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
            {Math.round(volume * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}

type MobilePanelProps = SharedPanelProps & {
  onDelete: (radio: Radio) => void;
  onEdit: (radio: Radio) => void;
  onSave: (radio: Radio) => void;
  onToggle: (radio: Radio, enabled: boolean) => void;
};

export function MobileNowPlayingPanel({
  radio,
  isPlaying,
  isLoading,
  isCrossfading,
  error,
  volume,
  isMuted,
  onPlayPause,
  onVolumeChange,
  onMuteToggle,
  onDelete,
  onEdit,
  onSave,
  onToggle,
}: MobilePanelProps) {
  if (!radio) {
    return null;
  }

  return (
    <div className="relative flex shrink-0 flex-col items-center gap-4 border-border/50 border-b px-5 py-5 lg:hidden">
      <div className="absolute top-3 right-3">
        <RadioItemActions
          onDelete={onDelete}
          onEdit={onEdit}
          onSave={onSave}
          onToggle={onToggle}
          radio={radio}
        />
      </div>

      <div className="relative size-28 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-black/20 shadow-black/5 shadow-lg">
        <RadioLogo
          className="size-28 rounded-xl"
          logoUrl={radio.logoUrl}
          name={radio.name}
          size="3xl"
        />
        {(isLoading || isCrossfading) && (
          <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
        )}
      </div>

      <div className="w-full text-center">
        <div className="flex items-center justify-center gap-1.5">
          <p className="truncate font-semibold text-lg">{radio.name}</p>
          {isSessionRadio(radio) && (
            <Badge
              className="h-4 shrink-0 border-[#00d084]/30 bg-[#00d084]/10 px-1 text-[#00d084] text-[10px]"
              variant="outline"
            >
              Unsaved
            </Badge>
          )}
        </div>
        {radio.placeTitle ? (
          <p className="mt-0.5 truncate text-muted-foreground/60 text-sm">
            {radio.placeTitle}, {radio.countryTitle}
          </p>
        ) : (
          radio.description && (
            <p className="mt-0.5 truncate text-muted-foreground/60 text-sm">
              {radio.description}
            </p>
          )
        )}
      </div>

      {!!error?.trim() && (
        <div className="rounded-md bg-destructive/10 px-3 py-1.5">
          <p className="font-mono text-destructive text-xs">{error}</p>
        </div>
      )}

      <PlayPauseButton
        className="size-14"
        disabled={isLoading || isCrossfading}
        iconClassName="size-6"
        isLoading={isLoading || isCrossfading}
        isPlaying={isPlaying}
        onClick={onPlayPause}
        size="sm"
        variant={isPlaying && !isLoading ? "outline" : "default"}
      />

      <div className="flex w-full items-center gap-2.5">
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
          className="h-2 flex-1"
          defaultValue={[1]}
          max={1}
          min={0}
          onValueChange={onVolumeChange}
          step={0.01}
          value={[volume]}
        />
        <span className="w-10 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </div>
  );
}
