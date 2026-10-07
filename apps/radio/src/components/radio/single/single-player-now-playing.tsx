import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Music2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { VolumeControl } from "@/components/audio/volume-control";
import type { Radio } from "@/lib/audio";
import type { RadioNowPlaying as RadioNowPlayingMetadata } from "@/lib/metadata/types";
import { EmptyHint } from "../empty-hint";
import { InlineError } from "../inline-error";
import { RadioNowPlaying } from "../radio-now-playing";

type SharedPanelProps = {
  radio: Radio | null;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  volume: number;
  isMuted: boolean;
  deviceVolume?: boolean;
  metadata?: RadioNowPlayingMetadata | null;
  actions?: ReactNode;
  onPlayPause: () => void;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
};

export function NowPlayingPanel(props: SharedPanelProps) {
  return <PlayerPanel {...props} />;
}

export function MobileNowPlayingPanel({
  radio,
  ...playerProps
}: SharedPanelProps) {
  if (!radio) {
    return null;
  }

  return (
    <div className="relative shrink-0 border-border/50 border-b px-4 py-4 sm:px-5 sm:py-5 lg:hidden [@media(max-height:600px)]:py-3 sm:[@media(max-height:600px)]:w-1/2 sm:[@media(max-height:600px)]:overflow-y-auto sm:[@media(max-height:600px)]:border-r sm:[@media(max-height:600px)]:border-b-0">
      <PlayerPanel {...playerProps} radio={radio} />
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
  deviceVolume,
  metadata,
  actions,
  onPlayPause,
  onVolumeChange,
  onMuteToggle,
}: SharedPanelProps) {
  if (!radio) {
    return (
      <EmptyHint className="py-24" icon={<Music2Icon />}>
        Nothing playing
      </EmptyHint>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 sm:gap-5">
      <RadioNowPlaying
        isLoading={isLoading}
        metadata={metadata}
        radio={radio}
        variant="featured"
      />

      {error?.trim() ? <InlineError>{error}</InlineError> : null}

      <div className="flex items-center gap-3 border-border/50 border-t pt-3 sm:gap-4 sm:pt-4">
        <PlayPauseButton
          className="size-12 shrink-0"
          iconClassName="size-5"
          isLoading={isLoading}
          isPlaying={isPlaying}
          onClick={onPlayPause}
          size="sm"
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          variant={isPlaying && !isLoading ? "outline" : "default"}
        />
        <VolumeControl
          className="flex-1"
          deviceVolume={deviceVolume}
          isMuted={isMuted}
          onToggleMute={onMuteToggle}
          onVolumeChange={onVolumeChange}
          volume={volume}
        />
        {actions ? (
          <div className="shrink-0 lg:absolute lg:top-3 lg:right-3">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
