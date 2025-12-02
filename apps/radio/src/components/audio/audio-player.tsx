import { useAudio } from "@avoid.quest/radio-audio";
import { Button } from "@workspace/ui/components/button";
import { Slider } from "@workspace/ui/components/slider";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import type { Radio } from "@/lib/types";

const MAX_VOLUME = 100;

export type AudioPlayerProps = {
  radio: Radio | null;
  className?: string;
  showVolume?: boolean;
  showStop?: boolean;
};

export function AudioPlayer({
  radio,
  className,
  showVolume = true,
  showStop = false,
}: AudioPlayerProps) {
  const {
    isPlaying,
    isLoading,
    volume,
    error,
    stop,
    setVolume,
    togglePlayPause,
  } = useAudio(radio);

  const handleVolumeChange = (value: number[]) => {
    const raw = value[0] ?? 0;
    setVolume(raw / MAX_VOLUME);
  };
  const handleMute = () => {
    setVolume(volume > 0 ? 0 : 1);
  };

  if (error) {
    return (
      <div
        className={cn("flex items-center gap-2 text-destructive", className)}
      >
        <div className="text-sm">{error.message}</div>
        <Button
          onClick={() => window.location.reload()}
          size="sm"
          variant="outline"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full items-center gap-2", className)}>
      {/* Play/Pause Button */}
      <Button
        className="min-w-[40px]"
        disabled={!radio || isLoading}
        onClick={togglePlayPause}
        size="sm"
        variant="outline"
      >
        {isLoading.valueOf() && <Spinner className="h-4 w-4" />}
        {isPlaying.valueOf() && <Pause className="h-4 w-4" />}
        {!(isLoading || isPlaying) && <Play className="h-4 w-4" />}
      </Button>

      {/* Stop Button */}
      {showStop.valueOf() && (
        <Button
          className="min-w-[40px]"
          disabled={!radio || isLoading}
          onClick={stop}
          size="sm"
          variant="outline"
        >
          <Square className="h-4 w-4" />
        </Button>
      )}

      {/* Volume Control */}
      {showVolume.valueOf() && (
        <div className="flex w-full min-w-[120px] items-center gap-2">
          <Button
            className="h-8 w-8 p-0"
            onClick={handleMute}
            size="sm"
            variant="ghost"
          >
            {volume > 0 ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </Button>
          <Slider
            className="flex-1"
            defaultValue={[MAX_VOLUME]}
            max={MAX_VOLUME}
            min={0}
            onValueChange={handleVolumeChange}
            step={1}
            value={[volume * MAX_VOLUME]}
          />
        </div>
      )}
    </div>
  );
}
