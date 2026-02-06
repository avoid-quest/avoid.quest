/**
 * Dynamic Effect MIDI Actions
 *
 * Registers MIDI actions for effect parameters based on effect schemas.
 */

import type { EffectConfig } from "@/lib/audio";
import {
  getEffectSchema,
  type ParamDef,
  type SliderParamDef,
} from "@/lib/audio/dsp/effects/schema";
import { updateDeckAEffect, updateDeckBEffect } from "@/lib/dj-actions";
import { MidiController } from "./midi-controller";
import type { MidiAction } from "./types";

/** Universal param ranges (same as universal-params.tsx) */
const UNIVERSAL_PARAMS: SliderParamDef[] = [
  {
    type: "slider",
    key: "dryWet",
    label: "Dry/Wet",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    type: "slider",
    key: "inputGain",
    label: "Input Gain",
    min: 0,
    max: 4.0,
    step: 0.01,
  },
  {
    type: "slider",
    key: "outputGain",
    label: "Output Gain",
    min: 0,
    max: 4.0,
    step: 0.01,
  },
];

/** Recursively extract all slider param defs from a schema's param tree */
function extractSliderParams(params: ParamDef[]): SliderParamDef[] {
  const sliders: SliderParamDef[] = [];
  for (const param of params) {
    if (param.type === "slider") {
      sliders.push(param);
    } else if (param.type === "group") {
      sliders.push(...extractSliderParams(param.children));
    }
  }
  return sliders;
}

/**
 * Register MIDI actions for a single effect instance on a deck.
 * Returns an unregister function.
 */
export function registerEffectActions(
  deckId: "deck-a" | "deck-b",
  effect: EffectConfig
): () => void {
  const schema = getEffectSchema(effect.type);
  if (!schema) {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op cleanup
    return () => {};
  }

  const updateEffect =
    deckId === "deck-a" ? updateDeckAEffect : updateDeckBEffect;
  const group = `${deckId}-effects`;
  const prefix = `${deckId}:effect:${effect.id}`;

  const sliderParams = [
    ...extractSliderParams(schema.params),
    ...UNIVERSAL_PARAMS,
  ];

  const actions: MidiAction[] = [];

  // Enabled toggle
  actions.push({
    targetId: `${prefix}:enabled`,
    label: `${schema.name} - Enabled`,
    group,
    type: "button",
    dispatch: () => {
      // Toggle: we read current state and flip
      updateEffect(effect.id, { enabled: !effect.enabled });
    },
  });

  // Slider params
  for (const param of sliderParams) {
    actions.push({
      targetId: `${prefix}:${param.key}`,
      label: `${schema.name} - ${param.label}`,
      group,
      type: "continuous",
      dispatch: (v) => {
        // Map 0-1 normalized to param's actual range
        const scaled = param.min + v * (param.max - param.min);
        updateEffect(effect.id, { [param.key]: scaled });
      },
      range: { min: param.min, max: param.max, step: param.step },
    });
  }

  return MidiController.getInstance().registerAll(actions);
}
