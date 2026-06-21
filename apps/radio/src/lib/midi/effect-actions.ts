/**
 * Dynamic Effect MIDI Actions
 *
 * Registers MIDI actions for effect parameters based on effect schemas.
 */

import type { EffectConfig } from "@/lib/audio";
import {
  getEffectMidiParamDefs,
  getEffectSchema,
} from "@/lib/audio/dsp/effects/schema";
import { getDjDeckActions } from "@/lib/dj-actions";
import { MidiController } from "./midi-controller";
import type { MidiAction } from "./types";

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

  const { updateEffect } = getDjDeckActions(deckId);
  const group = `${deckId}-effects`;
  const prefix = `${deckId}:effect:${effect.id}`;

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
  for (const param of getEffectMidiParamDefs(effect.type)) {
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
