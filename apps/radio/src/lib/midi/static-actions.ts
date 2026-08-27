import type { DjDeckModule } from "@/lib/dj-deck";
import type { MidiAction } from "./types";

type StaticMidiActionDependencies = {
  decks: Pick<DjDeckModule, "deck">;
  setCrossfadePosition: (position: number) => void;
  setHeadphoneVolume: (volume: number) => void;
  setMasterVolume: (volume: number) => void;
};

function createDeckActions(
  deckId: "deck-a" | "deck-b",
  decks: StaticMidiActionDependencies["decks"]
): MidiAction[] {
  return [
    {
      dispatch: () => {
        decks
          .deck(deckId)
          .transport({ type: "toggle" })
          .catch(() => undefined);
      },
      group: deckId,
      label: "Play/Pause",
      targetId: `${deckId}:play-pause`,
      type: "button",
    },
    {
      dispatch: () => decks.deck(deckId).change({ type: "cue" }),
      group: deckId,
      label: "CUE",
      targetId: `${deckId}:cue`,
      type: "button",
    },
    {
      dispatch: (volume) =>
        decks.deck(deckId).change({ type: "volume", volume }),
      group: deckId,
      label: "Volume",
      range: { max: 1.585, min: 0, step: 0.01 },
      targetId: `${deckId}:volume`,
      type: "continuous",
    },
    {
      dispatch: (value) =>
        decks.deck(deckId).change({ speed: 0.5 + value * 1.5, type: "speed" }),
      group: deckId,
      label: "Speed",
      range: { max: 2, min: 0.5, step: 0.01 },
      targetId: `${deckId}:speed`,
      type: "continuous",
    },
    {
      dispatch: (value) =>
        decks
          .deck(deckId)
          .change({ type: "channel-filter", value: value * 2 - 1 }),
      group: deckId,
      label: "Filter",
      range: { max: 1, min: -1, step: 0.01 },
      targetId: `${deckId}:filter`,
      type: "continuous",
    },
    {
      dispatch: (value) =>
        decks.deck(deckId).change({ type: "effects-dry-wet", value }),
      group: deckId,
      label: "FX Dry/Wet",
      range: { max: 1, min: 0, step: 0.01 },
      targetId: `${deckId}:effects-drywet`,
      type: "continuous",
    },
    {
      dispatch: (value) =>
        decks.deck(deckId).change({ pan: value * 2 - 1, type: "pan" }),
      group: deckId,
      label: "Pan",
      range: { max: 1, min: -1, step: 0.01 },
      targetId: `${deckId}:pan`,
      type: "continuous",
    },
  ];
}

export function createStaticMidiActions({
  decks,
  setCrossfadePosition,
  setHeadphoneVolume,
  setMasterVolume,
}: StaticMidiActionDependencies): MidiAction[] {
  return [
    ...createDeckActions("deck-a", decks),
    ...createDeckActions("deck-b", decks),
    {
      dispatch: setCrossfadePosition,
      group: "mixer",
      label: "Crossfader",
      range: { max: 1, min: 0, step: 0.01 },
      targetId: "mixer:crossfader",
      type: "continuous",
    },
    {
      dispatch: setMasterVolume,
      group: "mixer",
      label: "Master Volume",
      range: { max: 1, min: 0, step: 0.01 },
      targetId: "mixer:master-volume",
      type: "continuous",
    },
    {
      dispatch: setHeadphoneVolume,
      group: "mixer",
      label: "Headphone Volume",
      range: { max: 1, min: 0, step: 0.01 },
      targetId: "mixer:headphone-volume",
      type: "continuous",
    },
  ];
}
