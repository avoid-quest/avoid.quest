import type { Radio } from "@/lib/audio";
import { DeckPanel } from "./deck/deck-panel";
import { MixerPanel } from "./mixer/mixer-panel";

type DjConsoleProps = {
  radios: Radio[];
  crossfadePosition: number;
  masterVolume: number;
  headphoneVolume: number;
  deckACueEnabled: boolean;
  deckBCueEnabled: boolean;
  isCueActive: boolean;
  onCrossfadeChange: (position: number) => void;
  onMasterVolumeChange: (volume: number) => void;
  onHeadphoneVolumeChange: (volume: number) => void;
  onDeckACueChange: (enabled: boolean) => void;
  onDeckBCueChange: (enabled: boolean) => void;
};

export function DjConsole({
  radios,
  crossfadePosition,
  masterVolume,
  headphoneVolume,
  deckACueEnabled,
  deckBCueEnabled,
  isCueActive,
  onCrossfadeChange,
  onMasterVolumeChange,
  onHeadphoneVolumeChange,
  onDeckACueChange,
  onDeckBCueChange,
}: DjConsoleProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border/50 bg-card/50">
      {/* Deck A | VU A | Mixer | VU B | Deck B */}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_21rem_1fr]">
        {/* Deck A */}
        <DeckPanel
          className="min-h-0 overflow-hidden"
          deckId="deck-a"
          radios={radios}
        />

        {/* Mixer */}
        <MixerPanel
          crossfadePosition={crossfadePosition}
          deckACueEnabled={deckACueEnabled}
          deckBCueEnabled={deckBCueEnabled}
          headphoneVolume={headphoneVolume}
          isCueActive={isCueActive}
          masterVolume={masterVolume}
          onCrossfadeChange={onCrossfadeChange}
          onDeckACueChange={onDeckACueChange}
          onDeckBCueChange={onDeckBCueChange}
          onHeadphoneVolumeChange={onHeadphoneVolumeChange}
          onMasterVolumeChange={onMasterVolumeChange}
        />

        {/* Deck B */}
        <DeckPanel
          className="min-h-0 overflow-hidden"
          deckId="deck-b"
          radios={radios}
        />
      </div>
    </div>
  );
}
