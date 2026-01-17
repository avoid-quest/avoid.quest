import { AudioPlayer } from "@/components/audio";
import type { Radio } from "@/lib/audio";

type CustomPlayerProps = {
  radio: Radio;
};

export function CustomPlayer({ radio }: CustomPlayerProps) {
  return (
    <div className="flex w-full items-center gap-10">
      <AudioPlayer radio={radio} showStop={false} showVolume={true} />
    </div>
  );
}
