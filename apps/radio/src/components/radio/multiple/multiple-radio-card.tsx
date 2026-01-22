import { Button } from "@avoid.quest/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@avoid.quest/ui/components/card";
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Slider } from "@avoid.quest/ui/components/slider";
import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { useState } from "react";
import type { MultipleAudioState, Radio } from "@/lib/audio";
import { RadioItemActions } from "../radio-item-actions";
import { RadioLogo } from "../radio-logo";
import { RadioNameLink } from "../radio-name-link";

type MultipleRadioCardProps = {
  radio: Radio;
  playerState: MultipleAudioState | null;
  onTogglePlayPause: () => void;
  onVolumeChange: (volume: number) => void;
  onEdit?: (radio: Radio) => void;
  onDelete?: (radio: Radio) => void;
  onToggle?: (radio: Radio, enabled: boolean) => void;
};

export function MultipleRadioCard({
  radio,
  playerState,
  onTogglePlayPause,
  onVolumeChange,
  onEdit,
  onDelete,
  onToggle,
}: MultipleRadioCardProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [unmutedVolume, setUnmutedVolume] = useState(1);

  const isPlaying = playerState?.isPlaying ?? false;
  const isLoading = playerState?.isLoading ?? false;
  const volume = playerState?.volume ?? 1;
  const error = playerState?.error ?? null;

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0] ?? 0;
    onVolumeChange(newVolume);

    if (isMuted && newVolume > 0) {
      setUnmutedVolume(newVolume);
      setIsMuted(false);
    }
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      onVolumeChange(unmutedVolume);
      setIsMuted(false);
    } else {
      setUnmutedVolume(volume);
      onVolumeChange(0);
      setIsMuted(true);
    }
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <RadioLogo logoUrl={radio.logoUrl} name={radio.name} size="md" />
          <CardTitle>
            <RadioNameLink radio={radio} />
          </CardTitle>
        </div>
        <CardAction>
          <RadioItemActions
            onDelete={onDelete}
            onEdit={onEdit}
            onToggle={onToggle}
            radio={radio}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="text-destructive text-sm">Error: {error}</div>
        )}
        <div className="flex items-center gap-3">
          <PlayPauseButton
            className="size-9 shrink-0"
            iconClassName="size-4"
            isLoading={isLoading}
            isPlaying={isPlaying}
            onClick={onTogglePlayPause}
            size="sm"
            variant={isPlaying && !isLoading ? "outline" : "default"}
          />
          <Button
            aria-label={isMuted ? "Unmute" : "Mute"}
            className="size-9 shrink-0"
            onClick={handleMuteToggle}
            size="sm"
            variant="ghost"
          >
            {isMuted || volume === 0 ? (
              <VolumeXIcon className="size-4" />
            ) : (
              <Volume2Icon className="size-4" />
            )}
          </Button>
          <Slider
            className="flex-1"
            defaultValue={[1]}
            max={1}
            min={0}
            onValueChange={handleVolumeChange}
            step={0.05}
            value={[volume]}
          />
        </div>
      </CardContent>
    </Card>
  );
}
