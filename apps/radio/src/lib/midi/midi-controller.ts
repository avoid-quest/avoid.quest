/**
 * MIDI Controller
 *
 * Core class for Web MIDI API integration.
 * Handles device connection, message parsing, action dispatch, and learn mode.
 */

import {
  pauseDeckA,
  pauseDeckB,
  playDeckA,
  playDeckB,
  setCrossfadePosition,
  setDeckAChannelFilter,
  setDeckAEffectsDryWet,
  setDeckAPan,
  setDeckASpeed,
  setDeckAVolume,
  setDeckBChannelFilter,
  setDeckBEffectsDryWet,
  setDeckBPan,
  setDeckBSpeed,
  setDeckBVolume,
  setHeadphoneVolume,
  setMasterVolume,
  toggleDeckACue,
  toggleDeckBCue,
} from "@/lib/dj-actions";

// MIDI status bytes
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;

export type MidiMessageType = "cc" | "note";

export type MidiMapping = {
  channel: number;
  control: number;
  type: MidiMessageType;
  actionId: string;
};

export type MidiDeviceInfo = {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
  type: "input" | "output";
};

type MidiAction = {
  id: string;
  label: string;
  group: "deck-a" | "deck-b" | "mixer";
  type: "button" | "continuous";
  dispatch: (value: number) => void;
};

const MIDI_ACTIONS: MidiAction[] = [
  // Deck A
  {
    id: "deck-a:play",
    label: "Play",
    group: "deck-a",
    type: "button",
    dispatch: () => playDeckA(),
  },
  {
    id: "deck-a:pause",
    label: "Pause",
    group: "deck-a",
    type: "button",
    dispatch: () => pauseDeckA(),
  },
  {
    id: "deck-a:cue",
    label: "CUE",
    group: "deck-a",
    type: "button",
    dispatch: () => toggleDeckACue(),
  },
  {
    id: "deck-a:volume",
    label: "Volume",
    group: "deck-a",
    type: "continuous",
    dispatch: (v) => setDeckAVolume(v),
  },
  {
    id: "deck-a:pitch",
    label: "Pitch/Speed",
    group: "deck-a",
    type: "continuous",
    dispatch: (v) => setDeckASpeed(0.5 + v * 1.5),
  },
  {
    id: "deck-a:filter",
    label: "Filter",
    group: "deck-a",
    type: "continuous",
    dispatch: (v) => setDeckAChannelFilter(v * 2 - 1),
  },
  {
    id: "deck-a:effect-drywet",
    label: "FX Dry/Wet",
    group: "deck-a",
    type: "continuous",
    dispatch: (v) => setDeckAEffectsDryWet(v),
  },
  {
    id: "deck-a:pan",
    label: "Pan",
    group: "deck-a",
    type: "continuous",
    dispatch: (v) => setDeckAPan(v * 2 - 1),
  },

  // Deck B
  {
    id: "deck-b:play",
    label: "Play",
    group: "deck-b",
    type: "button",
    dispatch: () => playDeckB(),
  },
  {
    id: "deck-b:pause",
    label: "Pause",
    group: "deck-b",
    type: "button",
    dispatch: () => pauseDeckB(),
  },
  {
    id: "deck-b:cue",
    label: "CUE",
    group: "deck-b",
    type: "button",
    dispatch: () => toggleDeckBCue(),
  },
  {
    id: "deck-b:volume",
    label: "Volume",
    group: "deck-b",
    type: "continuous",
    dispatch: (v) => setDeckBVolume(v),
  },
  {
    id: "deck-b:pitch",
    label: "Pitch/Speed",
    group: "deck-b",
    type: "continuous",
    dispatch: (v) => setDeckBSpeed(0.5 + v * 1.5),
  },
  {
    id: "deck-b:filter",
    label: "Filter",
    group: "deck-b",
    type: "continuous",
    dispatch: (v) => setDeckBChannelFilter(v * 2 - 1),
  },
  {
    id: "deck-b:effect-drywet",
    label: "FX Dry/Wet",
    group: "deck-b",
    type: "continuous",
    dispatch: (v) => setDeckBEffectsDryWet(v),
  },
  {
    id: "deck-b:pan",
    label: "Pan",
    group: "deck-b",
    type: "continuous",
    dispatch: (v) => setDeckBPan(v * 2 - 1),
  },

  // Mixer
  {
    id: "crossfader",
    label: "Crossfader",
    group: "mixer",
    type: "continuous",
    dispatch: (v) => setCrossfadePosition(v),
  },
  {
    id: "master-volume",
    label: "Master Volume",
    group: "mixer",
    type: "continuous",
    dispatch: (v) => setMasterVolume(v),
  },
  {
    id: "headphone-volume",
    label: "Headphone Volume",
    group: "mixer",
    type: "continuous",
    dispatch: (v) => setHeadphoneVolume(v),
  },
];

export function getMidiActions(): MidiAction[] {
  return MIDI_ACTIONS;
}

export function getMidiActionById(id: string): MidiAction | undefined {
  return MIDI_ACTIONS.find((a) => a.id === id);
}

type MidiControllerCallbacks = {
  onDevicesChanged?: (devices: MidiDeviceInfo[]) => void;
  onLearnCapture?: (mapping: Omit<MidiMapping, "actionId">) => void;
};

export class MidiController {
  private static instance: MidiController | null = null;
  private access: MIDIAccess | null = null;
  private mappings: MidiMapping[] = [];
  private callbacks: MidiControllerCallbacks = {};
  private learningActionId: string | null = null;
  private lastCcDispatchTime = 0;
  private pendingRaf: number | null = null;
  private readonly pendingCcValues = new Map<string, number>();
  private readonly boundHandleMessage: (e: MIDIMessageEvent) => void;
  private readonly boundHandleStateChange: (e: Event) => void;

  private constructor() {
    this.boundHandleMessage = this.handleMidiMessage.bind(this);
    this.boundHandleStateChange = this.handleStateChange.bind(this);
  }

  static getInstance(): MidiController {
    if (!MidiController.instance) {
      MidiController.instance = new MidiController();
    }
    return MidiController.instance;
  }

  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.addEventListener("statechange", this.boundHandleStateChange);
      this.attachInputListeners();
      return true;
    } catch {
      return false;
    }
  }

  cleanup(): void {
    if (this.pendingRaf !== null) {
      cancelAnimationFrame(this.pendingRaf);
      this.pendingRaf = null;
    }
    this.pendingCcValues.clear();

    if (this.access) {
      this.access.removeEventListener(
        "statechange",
        this.boundHandleStateChange
      );
      for (const input of this.access.inputs.values()) {
        input.removeEventListener(
          "midimessage",
          this.boundHandleMessage as EventListener
        );
      }
      this.access = null;
    }

    this.learningActionId = null;
  }

  setCallbacks(callbacks: MidiControllerCallbacks): void {
    this.callbacks = callbacks;
  }

  setMappings(mappings: MidiMapping[]): void {
    this.mappings = mappings;
  }

  getDevices(): MidiDeviceInfo[] {
    if (!this.access) {
      return [];
    }

    const devices: MidiDeviceInfo[] = [];
    for (const input of this.access.inputs.values()) {
      devices.push({
        id: input.id,
        name: input.name ?? "Unknown MIDI Device",
        manufacturer: input.manufacturer ?? "",
        state: input.state,
        type: "input",
      });
    }
    return devices;
  }

  startLearn(actionId: string): void {
    this.learningActionId = actionId;
  }

  stopLearn(): void {
    this.learningActionId = null;
  }

  get isLearning(): boolean {
    return this.learningActionId !== null;
  }

  get learningTarget(): string | null {
    return this.learningActionId;
  }

  private attachInputListeners(): void {
    if (!this.access) {
      return;
    }
    for (const input of this.access.inputs.values()) {
      input.removeEventListener(
        "midimessage",
        this.boundHandleMessage as EventListener
      );
      input.addEventListener(
        "midimessage",
        this.boundHandleMessage as EventListener
      );
    }
  }

  private handleStateChange(_e: Event): void {
    // Re-attach listeners in case new devices were connected
    this.attachInputListeners();
    this.callbacks.onDevicesChanged?.(this.getDevices());
  }

  private handleMidiMessage(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 3) {
      return;
    }

    const statusByte = data[0] ?? 0;
    // biome-ignore lint/suspicious/noBitwiseOperators: MIDI protocol uses bitwise masks for status/channel extraction
    const statusType = statusByte & 0xf0;
    // biome-ignore lint/suspicious/noBitwiseOperators: MIDI protocol uses bitwise masks for status/channel extraction
    const channel = statusByte & 0x0f;
    const control = data[1] ?? 0;
    const value = data[2] ?? 0;

    let type: MidiMessageType;
    if (statusType === CONTROL_CHANGE) {
      type = "cc";
    } else if (statusType === NOTE_ON || statusType === NOTE_OFF) {
      type = "note";
    } else {
      return;
    }

    // Learn mode: capture the first incoming message
    if (this.learningActionId) {
      this.callbacks.onLearnCapture?.({ channel, control, type });
      this.learningActionId = null;
      return;
    }

    // Find matching mapping
    const mapping = this.mappings.find(
      (m) => m.channel === channel && m.control === control && m.type === type
    );
    if (!mapping) {
      return;
    }

    const action = getMidiActionById(mapping.actionId);
    if (!action) {
      return;
    }

    // Normalize value to 0-1
    const normalized = value / 127;

    if (action.type === "button") {
      // Dispatch immediately on NoteOn (velocity > 0) or CC value > 0
      if (value > 0) {
        action.dispatch(normalized);
      }
    } else {
      // Continuous controls: throttle via RAF (~30fps)
      this.pendingCcValues.set(mapping.actionId, normalized);
      this.scheduleDispatch();
    }
  }

  private scheduleDispatch(): void {
    if (this.pendingRaf !== null) {
      return;
    }

    this.pendingRaf = requestAnimationFrame(() => {
      this.pendingRaf = null;

      const now = performance.now();
      // ~30fps throttle
      if (now - this.lastCcDispatchTime < 33) {
        if (this.pendingCcValues.size > 0) {
          this.scheduleDispatch();
        }
        return;
      }
      this.lastCcDispatchTime = now;

      for (const [actionId, value] of this.pendingCcValues) {
        const action = getMidiActionById(actionId);
        if (action) {
          action.dispatch(value);
        }
      }
      this.pendingCcValues.clear();
    });
  }
}
