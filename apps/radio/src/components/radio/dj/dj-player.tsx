import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import type { Radio } from "@/lib/audio";
import {
  setCrossfadePosition,
  setHeadphoneVolume,
  setMasterVolume,
} from "@/lib/dj-actions";
import { getDjDeckModule } from "@/lib/dj-deck";
import { useDjKeyboard } from "@/lib/hooks/use-dj-keyboard";
import { useDeckA, useDeckB, useMixer } from "@/lib/hooks/use-dj-state";
import { useMediaSession } from "@/lib/hooks/use-media-session";
import { useMidi } from "@/lib/hooks/use-midi";
import { useAudioSettings } from "@/lib/hooks/use-settings";
import { DjConsole } from "./dj-console";
import { DjConsoleMobile } from "./dj-console-mobile";

type DjPlayerProps = {
  radios?: Radio[];
};

function handleDeckACueChange(enabled: boolean) {
  getDjDeckModule().deck("deck-a").change({ enabled, type: "cue" });
}

function handleDeckBCueChange(enabled: boolean) {
  getDjDeckModule().deck("deck-b").change({ enabled, type: "cue" });
}

export function DjPlayer({ radios = [] }: DjPlayerProps) {
  useDjKeyboard();
  useMidi();

  const mixer = useMixer();
  const audioSettings = useAudioSettings();
  const deckA = useDeckA();
  const deckB = useDeckB();

  const isPlaying = (deckA?.isPlaying ?? false) || (deckB?.isPlaying ?? false);
  useMediaSession({
    deckA: deckA?.radio ?? null,
    deckB: deckB?.radio ?? null,
    isPlaying,
    mode: "dj",
  });

  const crossfadePosition = mixer?.crossfadePosition ?? 0.5;
  const masterVolume = mixer?.masterVolume ?? 1;
  const headphoneVolume = mixer?.headphoneVolume ?? 1;
  const deckACueEnabled = mixer?.deckACueEnabled ?? false;
  const deckBCueEnabled = mixer?.deckBCueEnabled ?? false;
  const isCueActive = !!audioSettings.cueOutputId;
  const isMobile = useIsMobile();

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col px-2 py-2"
      style={{ touchAction: "manipulation" }}
    >
      {isMobile ? (
        <DjConsoleMobile
          crossfadePosition={crossfadePosition}
          deckACueEnabled={deckACueEnabled}
          deckBCueEnabled={deckBCueEnabled}
          isCueActive={isCueActive}
          masterVolume={masterVolume}
          onCrossfadeChange={setCrossfadePosition}
          onDeckACueChange={handleDeckACueChange}
          onDeckBCueChange={handleDeckBCueChange}
          onMasterVolumeChange={setMasterVolume}
          radios={radios}
        />
      ) : (
        <DjConsole
          crossfadePosition={crossfadePosition}
          deckACueEnabled={deckACueEnabled}
          deckBCueEnabled={deckBCueEnabled}
          headphoneVolume={headphoneVolume}
          isCueActive={isCueActive}
          masterVolume={masterVolume}
          onCrossfadeChange={setCrossfadePosition}
          onDeckACueChange={handleDeckACueChange}
          onDeckBCueChange={handleDeckBCueChange}
          onHeadphoneVolumeChange={setHeadphoneVolume}
          onMasterVolumeChange={setMasterVolume}
          radios={radios}
        />
      )}
    </div>
  );
}
