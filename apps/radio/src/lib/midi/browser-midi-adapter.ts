import type {
  MidiBrowserAccess,
  MidiBrowserAdapter,
  MidiBrowserInput,
} from "./midi-control";

function wrapInput(input: MIDIInput): MidiBrowserInput {
  return {
    get device() {
      return {
        id: input.id,
        manufacturer: input.manufacturer ?? "",
        name: input.name ?? "Unknown MIDI Device",
        state: input.state,
        type: "input" as const,
      };
    },
    subscribe(listener) {
      const handleMessage = (event: Event) => {
        const { data } = event as MIDIMessageEvent;
        if (data) {
          listener(Uint8Array.from(data));
        }
      };
      input.addEventListener("midimessage", handleMessage);
      return () => input.removeEventListener("midimessage", handleMessage);
    },
  };
}

function wrapAccess(access: MIDIAccess): MidiBrowserAccess {
  return {
    inputs: () => [...access.inputs.values()].map(wrapInput),
    subscribeStateChange(listener) {
      access.addEventListener("statechange", listener);
      return () => access.removeEventListener("statechange", listener);
    },
  };
}

export function createBrowserMidiAdapter(): MidiBrowserAdapter {
  return {
    cancelFrame(frameId) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frameId);
        return;
      }
      clearTimeout(frameId);
    },
    isSupported: () =>
      typeof navigator !== "undefined" &&
      typeof navigator.requestMIDIAccess === "function",
    now: () => performance.now(),
    async requestAccess() {
      if (
        typeof navigator === "undefined" ||
        typeof navigator.requestMIDIAccess !== "function"
      ) {
        throw new Error("Web MIDI is not supported");
      }
      return wrapAccess(await navigator.requestMIDIAccess({ sysex: false }));
    },
    requestFrame(callback) {
      return typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(callback)
        : (setTimeout(callback, 16) as unknown as number);
    },
    subscribePermission(listener) {
      if (typeof navigator === "undefined" || !("permissions" in navigator)) {
        return () => undefined;
      }
      let cancelled = false;
      let status: PermissionStatus | null = null;
      const handleChange = () => {
        if (!cancelled && status) {
          listener(status.state);
        }
      };
      navigator.permissions
        .query({ name: "midi", sysex: false } as PermissionDescriptor)
        .then((nextStatus) => {
          if (cancelled) {
            return;
          }
          status = nextStatus;
          listener(nextStatus.state);
          nextStatus.addEventListener("change", handleChange);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
        status?.removeEventListener("change", handleChange);
      };
    },
  };
}
