/**
 * MIDI Controller
 *
 * Core class for Web MIDI API integration.
 * Handles device connection, message parsing, action dispatch, learn mode,
 * and the action registry (merged from action-registry.ts).
 */

import { useMidiStore } from "./midi-store";
import {
  applyTransform,
  type MidiAction,
  type MidiDeviceInfo,
  type MidiMapping,
  type MidiMessageType,
  type MidiTargetId,
} from "./types";

// MIDI status bytes
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;

type Listener = () => void;

export class MidiController {
  private static instance: MidiController | null = null;
  private access: MIDIAccess | null = null;
  private mappings = new Map<string, MidiMapping>();
  private lastCcDispatchTime = 0;
  private pendingRaf: number | null = null;
  private readonly pendingCcValues = new Map<string, number>();
  private readonly lastButtonDispatch = new Map<string, number>();
  private readonly boundHandleMessage: EventListener;
  private readonly boundHandleStateChange: EventListener;

  // Action registry (absorbed from MidiActionRegistry)
  private readonly actions = new Map<MidiTargetId, MidiAction>();
  private readonly listeners = new Set<Listener>();
  private snapshot: MidiAction[] = [];

  private constructor() {
    this.boundHandleMessage = (e: Event) =>
      this.handleMidiMessage(e as MIDIMessageEvent);
    this.boundHandleStateChange = (e: Event) => this.handleStateChange(e);
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
    } catch (error) {
      console.warn("[MidiController] init failed:", error);
      return false;
    }
  }

  cleanup(): void {
    if (this.pendingRaf !== null) {
      cancelAnimationFrame(this.pendingRaf);
      this.pendingRaf = null;
    }
    this.pendingCcValues.clear();
    this.lastButtonDispatch.clear();

    if (this.access) {
      this.access.removeEventListener(
        "statechange",
        this.boundHandleStateChange
      );
      for (const input of this.access.inputs.values()) {
        input.removeEventListener("midimessage", this.boundHandleMessage);
      }
      this.access = null;
    }
  }

  setMappings(mappingsByKey: Map<string, MidiMapping>): void {
    this.mappings = mappingsByKey;
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

  // --- Action Registry methods ---

  register(action: MidiAction): () => void {
    this.actions.set(action.targetId, action);
    this.notifyListeners();
    return () => {
      this.actions.delete(action.targetId);
      this.notifyListeners();
    };
  }

  registerAll(actions: MidiAction[]): () => void {
    for (const action of actions) {
      this.actions.set(action.targetId, action);
    }
    this.notifyListeners();
    return () => {
      for (const action of actions) {
        this.actions.delete(action.targetId);
      }
      this.notifyListeners();
    };
  }

  getAction(targetId: MidiTargetId): MidiAction | undefined {
    return this.actions.get(targetId);
  }

  getAllActions(): MidiAction[] {
    return this.snapshot;
  }

  getActionsByGroup(group: string): MidiAction[] {
    return this.snapshot.filter((a) => a.group === group);
  }

  subscribeActions(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.snapshot = [...this.actions.values()];
    for (const listener of this.listeners) {
      listener();
    }
  }

  // --- MIDI message handling ---

  private attachInputListeners(): void {
    if (!this.access) {
      return;
    }
    for (const input of this.access.inputs.values()) {
      input.removeEventListener("midimessage", this.boundHandleMessage);
      input.addEventListener("midimessage", this.boundHandleMessage);
    }
  }

  private handleStateChange(_e: Event): void {
    // Re-attach listeners in case new devices were connected
    this.attachInputListeners();
    const store = useMidiStore.getState();
    store.setDevices(this.getDevices());
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

    // Learn mode: capture the first incoming message, delegate to store
    const store = useMidiStore.getState();
    if (store.learningTarget) {
      const target = store.learningTarget;
      store.addMapping({ channel, control, type, targetId: target });
      store.stopLearn();
      return;
    }

    // O(1) mapping lookup
    const mapping = this.mappings.get(`${channel}:${control}:${type}`);
    if (!mapping) {
      return;
    }

    const action = this.actions.get(mapping.targetId);
    if (!action) {
      return;
    }

    // Normalize value to 0-1
    let normalized = value / 127;

    // Apply per-mapping transform if present
    if (mapping.transform) {
      normalized = applyTransform(normalized, mapping.transform);
    }

    if (action.type === "button") {
      this.dispatchButton(
        mapping.targetId,
        action,
        normalized,
        value,
        statusType
      );
    } else {
      // Continuous controls: throttle via RAF (~30fps)
      this.pendingCcValues.set(mapping.targetId, normalized);
      this.scheduleDispatch();
    }
  }

  /**
   * Dispatch a button action with two guards against double-triggering:
   * 1. NoteOff filter — key release (0x80) often carries velocity > 0.
   * 2. Dedup window — contact bounce can send duplicate NoteOn within ~5ms;
   *    50ms blocks bounce while allowing intentional rapid presses (>100ms).
   */
  private dispatchButton(
    targetId: string,
    action: { dispatch: (value: number) => void },
    normalized: number,
    rawValue: number,
    statusType: number
  ): void {
    if (rawValue === 0 || statusType === NOTE_OFF) {
      return;
    }
    const now = performance.now();
    const last = this.lastButtonDispatch.get(targetId) ?? 0;
    if (now - last > 50) {
      this.lastButtonDispatch.set(targetId, now);
      action.dispatch(normalized);
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

      for (const [targetId, val] of this.pendingCcValues) {
        const action = this.actions.get(targetId);
        if (action) {
          action.dispatch(val);
        }
      }
      this.pendingCcValues.clear();
    });
  }
}
