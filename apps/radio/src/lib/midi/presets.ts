/**
 * MIDI Presets
 *
 * Built-in controller mappings for common DJ MIDI controllers.
 */

import type { MidiMapping, MidiMessageType } from "./midi-controller";

export type MidiPreset = {
  id: string;
  name: string;
  vendor: string;
  mappings: MidiMapping[];
};

function mapping(
  channel: number,
  control: number,
  type: MidiMessageType,
  actionId: string
): MidiMapping {
  return { channel, control, type, actionId };
}

/**
 * Pioneer DDJ-200
 *
 * 2-channel portable DJ controller.
 * Uses channels 0-1 for decks, CC for continuous, Note for buttons.
 */
const PIONEER_DDJ_200: MidiPreset = {
  id: "pioneer-ddj-200",
  name: "Pioneer DDJ-200",
  vendor: "Pioneer DJ",
  mappings: [
    // Deck A (channel 0)
    mapping(0, 0x0b, "note", "deck-a:play"),
    mapping(0, 0x0c, "note", "deck-a:cue"),
    mapping(0, 0x13, "cc", "deck-a:volume"),
    mapping(0, 0x0d, "cc", "deck-a:pitch"),
    mapping(0, 0x17, "cc", "deck-a:filter"),
    mapping(0, 0x1a, "cc", "deck-a:effect-drywet"),

    // Deck B (channel 1)
    mapping(1, 0x0b, "note", "deck-b:play"),
    mapping(1, 0x0c, "note", "deck-b:cue"),
    mapping(1, 0x13, "cc", "deck-b:volume"),
    mapping(1, 0x0d, "cc", "deck-b:pitch"),
    mapping(1, 0x17, "cc", "deck-b:filter"),
    mapping(1, 0x1a, "cc", "deck-b:effect-drywet"),

    // Mixer
    mapping(0, 0x1f, "cc", "crossfader"),
    mapping(0, 0x05, "cc", "master-volume"),
  ],
};

/**
 * Numark DJ2GO2 Touch
 *
 * Ultra-portable 2-channel controller with capacitive jog wheels.
 * All controls on channel 0, deck differentiated by control numbers.
 */
const NUMARK_DJ2GO2_TOUCH: MidiPreset = {
  id: "numark-dj2go2-touch",
  name: "Numark DJ2GO2 Touch",
  vendor: "Numark",
  mappings: [
    // Deck A
    mapping(0, 0x3b, "note", "deck-a:play"),
    mapping(0, 0x33, "note", "deck-a:cue"),
    mapping(0, 0x07, "cc", "deck-a:volume"),
    mapping(0, 0x09, "cc", "deck-a:pitch"),
    mapping(0, 0x0e, "cc", "deck-a:filter"),

    // Deck B
    mapping(0, 0x42, "note", "deck-b:play"),
    mapping(0, 0x3c, "note", "deck-b:cue"),
    mapping(0, 0x08, "cc", "deck-b:volume"),
    mapping(0, 0x0a, "cc", "deck-b:pitch"),
    mapping(0, 0x0f, "cc", "deck-b:filter"),

    // Mixer
    mapping(0, 0x03, "cc", "crossfader"),
    mapping(0, 0x06, "cc", "master-volume"),
  ],
};

/**
 * Generic 2-Deck Controller
 *
 * A sensible default layout for generic MIDI controllers.
 * Deck A on channel 0, Deck B on channel 1, mixer on channel 0.
 */
const GENERIC_2_DECK: MidiPreset = {
  id: "generic-2-deck",
  name: "Generic 2-Deck",
  vendor: "Generic",
  mappings: [
    // Deck A (channel 0)
    mapping(0, 0x30, "note", "deck-a:play"),
    mapping(0, 0x31, "note", "deck-a:pause"),
    mapping(0, 0x32, "note", "deck-a:cue"),
    mapping(0, 0x07, "cc", "deck-a:volume"),
    mapping(0, 0x01, "cc", "deck-a:pitch"),
    mapping(0, 0x4a, "cc", "deck-a:filter"),
    mapping(0, 0x5b, "cc", "deck-a:effect-drywet"),
    mapping(0, 0x0a, "cc", "deck-a:pan"),

    // Deck B (channel 1)
    mapping(1, 0x30, "note", "deck-b:play"),
    mapping(1, 0x31, "note", "deck-b:pause"),
    mapping(1, 0x32, "note", "deck-b:cue"),
    mapping(1, 0x07, "cc", "deck-b:volume"),
    mapping(1, 0x01, "cc", "deck-b:pitch"),
    mapping(1, 0x4a, "cc", "deck-b:filter"),
    mapping(1, 0x5b, "cc", "deck-b:effect-drywet"),
    mapping(1, 0x0a, "cc", "deck-b:pan"),

    // Mixer (channel 0)
    mapping(0, 0x11, "cc", "crossfader"),
    mapping(0, 0x0c, "cc", "master-volume"),
    mapping(0, 0x0d, "cc", "headphone-volume"),
  ],
};

export const MIDI_PRESETS: MidiPreset[] = [
  PIONEER_DDJ_200,
  NUMARK_DJ2GO2_TOUCH,
  GENERIC_2_DECK,
];

export function getMidiPresetById(id: string): MidiPreset | undefined {
  return MIDI_PRESETS.find((p) => p.id === id);
}
