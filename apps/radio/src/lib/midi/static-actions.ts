/**
 * Static MIDI Actions
 *
 * Registers the built-in (non-effect) MIDI actions for decks and mixer.
 */

import {
  getDjDeckActions,
  setCrossfadePosition,
  setHeadphoneVolume,
  setMasterVolume,
} from "@/lib/dj-actions";
import {
  getDeckARuntime,
  getDeckBRuntime,
} from "@/lib/stores/dj-runtime-store";
import { MidiController } from "./midi-controller";
import type { MidiAction } from "./types";

function createDeckActions(deckId: "deck-a" | "deck-b"): MidiAction[] {
  const isA = deckId === "deck-a";
  const getRuntime = isA ? getDeckARuntime : getDeckBRuntime;
  const {
    play,
    pause,
    setVolume,
    setSpeed,
    setChannelFilter,
    setEffectsDryWet,
    setPan,
    toggleCue,
  } = getDjDeckActions(deckId);

  return [
    {
      targetId: `${deckId}:play-pause`,
      label: "Play/Pause",
      group: deckId,
      type: "button",
      dispatch: () => {
        if (getRuntime().isPlaying) {
          pause();
        } else {
          play();
        }
      },
    },
    {
      targetId: `${deckId}:cue`,
      label: "CUE",
      group: deckId,
      type: "button",
      dispatch: () => toggleCue(),
    },
    {
      targetId: `${deckId}:volume`,
      label: "Volume",
      group: deckId,
      type: "continuous",
      dispatch: (v) => setVolume(v),
      range: { min: 0, max: 1.585, step: 0.01 },
    },
    {
      targetId: `${deckId}:speed`,
      label: "Speed",
      group: deckId,
      type: "continuous",
      dispatch: (v) => setSpeed(0.5 + v * 1.5),
      range: { min: 0.5, max: 2.0, step: 0.01 },
    },
    {
      targetId: `${deckId}:filter`,
      label: "Filter",
      group: deckId,
      type: "continuous",
      dispatch: (v) => setChannelFilter(v * 2 - 1),
      range: { min: -1, max: 1, step: 0.01 },
    },
    {
      targetId: `${deckId}:effects-drywet`,
      label: "FX Dry/Wet",
      group: deckId,
      type: "continuous",
      dispatch: (v) => setEffectsDryWet(v),
      range: { min: 0, max: 1, step: 0.01 },
    },
    {
      targetId: `${deckId}:pan`,
      label: "Pan",
      group: deckId,
      type: "continuous",
      dispatch: (v) => setPan(v * 2 - 1),
      range: { min: -1, max: 1, step: 0.01 },
    },
  ];
}

const MIXER_ACTIONS: MidiAction[] = [
  {
    targetId: "mixer:crossfader",
    label: "Crossfader",
    group: "mixer",
    type: "continuous",
    dispatch: (v) => setCrossfadePosition(v),
    range: { min: 0, max: 1, step: 0.01 },
  },
  {
    targetId: "mixer:master-volume",
    label: "Master Volume",
    group: "mixer",
    type: "continuous",
    dispatch: (v) => setMasterVolume(v),
    range: { min: 0, max: 1, step: 0.01 },
  },
  {
    targetId: "mixer:headphone-volume",
    label: "Headphone Volume",
    group: "mixer",
    type: "continuous",
    dispatch: (v) => setHeadphoneVolume(v),
    range: { min: 0, max: 1, step: 0.01 },
  },
];

export function registerStaticActions(): () => void {
  const allActions = [
    ...createDeckActions("deck-a"),
    ...createDeckActions("deck-b"),
    ...MIXER_ACTIONS,
  ];
  return MidiController.getInstance().registerAll(allActions);
}
