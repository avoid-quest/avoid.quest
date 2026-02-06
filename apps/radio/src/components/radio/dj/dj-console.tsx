import type { Radio } from "@/lib/audio";
import {
  useDeckAPeakLevel,
  useDeckBPeakLevel,
} from "@/lib/stores/dj-runtime-store";
import { BrowserPanel } from "./browser/browser-panel";
import { DeckPanel } from "./deck/deck-panel";
import { MixerPanel } from "./mixer/mixer-panel";
import { DeckPeakMeter } from "./shared/peak-meter";

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
  const deckAPeakLevel = useDeckAPeakLevel();
  const deckBPeakLevel = useDeckBPeakLevel();

  return (
    <div className="grid h-full min-h-0 w-full grid-rows-[1fr_auto] overflow-hidden rounded-lg border border-border/50 bg-card/50">
      {/* Main row: Deck A | VU A | Mixer | VU B | Deck B */}
      <div className="grid min-h-0 grid-cols-[1fr_auto_280px_auto_1fr]">
        {/* Deck A */}
        <DeckPanel
          className="min-h-0 overflow-hidden"
          deckId="deck-a"
          radios={radios}
        />

        {/* VU A — inner edge */}
        <DeckPeakMeter
          className="border-border/50 border-l"
          peakLevel={deckAPeakLevel}
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

        {/* VU B — inner edge */}
        <DeckPeakMeter
          className="border-border/50 border-r"
          peakLevel={deckBPeakLevel}
        />

        {/* Deck B */}
        <DeckPanel
          className="min-h-0 overflow-hidden"
          deckId="deck-b"
          radios={radios}
        />
      </div>

      {/* Browser row */}
      <BrowserPanel radios={radios} />
    </div>
  );
}
