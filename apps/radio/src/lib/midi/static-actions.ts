import type { DjDeckModule } from "@/lib/dj-deck";
import type { OutputRouting } from "@/lib/output-routing";
import type { MidiAction } from "./types";

type StaticMidiActionDependencies = {
  decks: Pick<DjDeckModule, "deck">;
  output: Pick<OutputRouting, "setHeadphoneVolume">;
  setCrossfadePosition(position: number): void;
  setMasterVolume(volume: number): void;
};

function createDeckActions(
  deckId: "deck-a" | "deck-b",
  decks: StaticMidiActionDependencies["decks"]
): MidiAction[] {
  return [
    {
      targetId: `${deckId}:play-pause`,
      label: "Play/Pause",
      group: deckId,
      type: "button",
      dispatch: () => {
        decks
          .deck(deckId)
          .transport({ type: "toggle" })
          .catch(() => undefined);
      },
    },
    {
      targetId: `${deckId}:cue`,
      label: "CUE",
      group: deckId,
      type: "button",
      dispatch: () => decks.deck(deckId).change({ type: "cue" }),
    },
    {
      targetId: `${deckId}:volume`,
      label: "Volume",
      group: deckId,
      type: "continuous",
      dispatch: (volume) =>
        decks.deck(deckId).change({ type: "volume", volume }),
      range: { min: 0, max: 1.585, step: 0.01 },
    },
    {
      targetId: `${deckId}:speed`,
      label: "Speed",
      group: deckId,
      type: "continuous",
      dispatch: (value) =>
        decks.deck(deckId).change({ type: "speed", speed: 0.5 + value * 1.5 }),
      range: { min: 0.5, max: 2, step: 0.01 },
    },
    {
      targetId: `${deckId}:filter`,
      label: "Filter",
      group: deckId,
      type: "continuous",
      dispatch: (value) =>
        decks
          .deck(deckId)
          .change({ type: "channel-filter", value: value * 2 - 1 }),
      range: { min: -1, max: 1, step: 0.01 },
    },
    {
      targetId: `${deckId}:effects-drywet`,
      label: "FX Dry/Wet",
      group: deckId,
      type: "continuous",
      dispatch: (value) =>
        decks.deck(deckId).change({ type: "effects-dry-wet", value }),
      range: { min: 0, max: 1, step: 0.01 },
    },
    {
      targetId: `${deckId}:pan`,
      label: "Pan",
      group: deckId,
      type: "continuous",
      dispatch: (value) =>
        decks.deck(deckId).change({ type: "pan", pan: value * 2 - 1 }),
      range: { min: -1, max: 1, step: 0.01 },
    },
  ];
}

export function createStaticMidiActions({
  decks,
  output,
  setCrossfadePosition,
  setMasterVolume,
}: StaticMidiActionDependencies): MidiAction[] {
  return [
    ...createDeckActions("deck-a", decks),
    ...createDeckActions("deck-b", decks),
    {
      targetId: "mixer:crossfader",
      label: "Crossfader",
      group: "mixer",
      type: "continuous",
      dispatch: setCrossfadePosition,
      range: { min: 0, max: 1, step: 0.01 },
    },
    {
      targetId: "mixer:master-volume",
      label: "Master Volume",
      group: "mixer",
      type: "continuous",
      dispatch: setMasterVolume,
      range: { min: 0, max: 1, step: 0.01 },
    },
    {
      targetId: "mixer:headphone-volume",
      label: "Headphone Volume",
      group: "mixer",
      type: "continuous",
      dispatch: (volume) => output.setHeadphoneVolume(volume),
      range: { min: 0, max: 1, step: 0.01 },
    },
  ];
}
