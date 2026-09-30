/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import { DEFAULT_INPUT_STRIP } from "@/lib/node-graph/schema";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://radio.test",
});

class ObserverStub {
  disconnect() {
    // JSDOM does not perform layout.
  }

  observe() {
    // JSDOM does not perform layout.
  }

  unobserve() {
    // JSDOM does not perform layout.
  }
}

for (const [key, value] of Object.entries({
  CustomEvent: dom.window.CustomEvent,
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLButtonElement: dom.window.HTMLButtonElement,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  IntersectionObserver: ObserverStub,
  KeyboardEvent: dom.window.KeyboardEvent,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

// React DOM checks for input events when it loads, so it loads after the DOM.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

afterEach(cleanup);

type Device = { deviceId: string; kind: string; label: string };

/** The browser's media devices, with a hot-plug and a permission to set. */
const media = {
  devices: [] as Device[],
  getUserMedia: mock(() => {
    if (media.permission === "denied") {
      return Promise.reject(new DOMException("Blocked", "NotAllowedError"));
    }
    media.permission = "granted";
    return Promise.resolve({ getTracks: () => [] });
  }),
  handlers: new Set<() => void>(),
  permission: "prompt" as "prompt" | "granted" | "denied",
  permissionHandlers: new Set<() => void>(),
};

function plug(devices: Device[]) {
  media.devices = devices;
  for (const handler of media.handlers) {
    handler();
  }
}

function changePermission(state: typeof media.permission) {
  media.permission = state;
  for (const handler of media.permissionHandlers) {
    handler();
  }
}

const MIC = { deviceId: "mic", kind: "audioinput", label: "Desk mic" };
const LINE = { deviceId: "line", kind: "audioinput", label: "Line in" };
const USB = { deviceId: "usb", kind: "audiooutput", label: "USB interface" };

let AudioInputNodeBody: typeof import("./audio-input-node")["AudioInputNodeBody"];
let OutputDeviceNodeBody: typeof import("./output-device-node")["OutputDeviceNodeBody"];
let NodeSourceRow: typeof import("./node-source-row")["NodeSourceRow"];
let useNodeDevices: typeof import("./use-node-devices")["useNodeDevices"];
let deviceInputRadio: typeof import("@/lib/node-graph/compile")["deviceInputRadio"];
let setPlaybackChannelRuntime: typeof import("@/lib/stores/playback-runtime-store")["setPlaybackChannelRuntime"];
let resetAllPlaybackRuntime: typeof import("@/lib/stores/playback-runtime-store")["resetAllPlaybackRuntime"];

beforeAll(async () => {
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      addEventListener: (_type: string, handler: () => void) => {
        media.handlers.add(handler);
      },
      enumerateDevices: async () =>
        // Without permission a browser hides names.
        media.permission === "granted"
          ? media.devices
          : media.devices.map((device) => ({ ...device, label: "" })),
      getUserMedia: media.getUserMedia,
      removeEventListener: (_type: string, handler: () => void) => {
        media.handlers.delete(handler);
      },
    },
  });
  Object.defineProperty(dom.window.navigator, "permissions", {
    configurable: true,
    value: {
      query: async () => ({
        addEventListener: (_type: string, handler: () => void) => {
          media.permissionHandlers.add(handler);
        },
        removeEventListener: (_type: string, handler: () => void) => {
          media.permissionHandlers.delete(handler);
        },
        get state() {
          return media.permission;
        },
      }),
    },
  });
  ({ AudioInputNodeBody } = await import("./audio-input-node"));
  ({ OutputDeviceNodeBody } = await import("./output-device-node"));
  ({ NodeSourceRow } = await import("./node-source-row"));
  ({ useNodeDevices } = await import("./use-node-devices"));
  ({ deviceInputRadio } = await import("@/lib/node-graph/compile"));
  ({ resetAllPlaybackRuntime, setPlaybackChannelRuntime } = await import(
    "@/lib/stores/playback-runtime-store"
  ));
});

beforeEach(() => {
  media.devices = [MIC, LINE, USB];
  media.permission = "prompt";
  media.getUserMedia.mockClear();
  resetAllPlaybackRuntime();
});

const noop = () => undefined;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

type InputData = Parameters<typeof AudioInputNodeBody>[0]["data"];

function inputData(overrides: Partial<InputData> = {}): InputData {
  return {
    channelSelection: { left: 0, right: 1 },
    deviceId: "mic",
    deviceLabel: "Desk mic",
    echoCancellation: false,
    feedsOutput: false,
    muted: false,
    strip: DEFAULT_INPUT_STRIP,
    volume: 1,
    ...overrides,
  };
}

/** The canvas body over the real device hook, as the node mounts it. */
function InputHarness({
  data = inputData(),
  isPlaying = false,
  onToggleLive = noop,
  onEchoCancellationChange = noop,
}: {
  data?: InputData;
  isPlaying?: boolean;
  onToggleLive?: () => void;
  onEchoCancellationChange?: (enabled: boolean) => void;
}) {
  const devices = useNodeDevices();
  return (
    <AudioInputNodeBody
      data={data}
      devices={devices}
      error={null}
      isLoading={false}
      isPlaying={isPlaying}
      onChannelsChange={noop}
      onEchoCancellationChange={onEchoCancellationChange}
      onPickDevice={noop}
      onRemove={noop}
      onToggleLive={onToggleLive}
      onToggleMute={noop}
      onVolumeChange={noop}
    />
  );
}

describe("Audio input node", () => {
  test("asks for the microphone with a gesture, which calls getUserMedia", async () => {
    const view = render(<InputHarness />);
    await flush();

    const allow = view.getByRole("button", { name: "Allow microphone" });
    fireEvent.click(allow);
    await flush();

    expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(view.queryByRole("button", { name: "Allow microphone" })).toBeNull();
  });

  test("a blocked microphone says where to allow it, and offers no Go live", async () => {
    media.permission = "denied";
    const view = render(<InputHarness />);
    await flush();

    expect(
      view.getByText("Microphone blocked. Allow it in your browser settings.")
    ).toBeTruthy();
    const goLive = view.getByRole("button", { name: "Go live Desk mic" });
    expect((goLive as HTMLButtonElement).disabled).toBe(true);
    expect(
      view.queryByRole("combobox", { name: "Audio input device" })
    ).toBeNull();
  });

  test("an allowed input shows its device, channels and Go live", async () => {
    media.permission = "granted";
    const onToggleLive = mock(noop);
    const view = render(<InputHarness onToggleLive={onToggleLive} />);
    await flush();

    expect(
      view.getByRole("combobox", { name: "Audio input device" }).textContent
    ).toContain("Desk mic");
    expect(view.getByRole("combobox", { name: "Input channels" })).toBeTruthy();
    expect(view.getByText("Off")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Go live Desk mic" }));
    expect(onToggleLive).toHaveBeenCalledTimes(1);
  });

  test("resetting a blocked permission offers an explicit microphone request", async () => {
    media.permission = "denied";
    const view = render(<InputHarness />);
    await flush();

    act(() => changePermission("prompt"));
    await flush();

    expect(
      view.queryByText("Microphone blocked. Allow it in your browser settings.")
    ).toBeNull();
    const allow = view.getByRole("button", { name: "Allow microphone" });
    expect(media.getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(allow);
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("button", { name: "Allow microphone" })).toBeNull();
  });

  test("granting permission in browser settings enables Go live without capture", async () => {
    media.permission = "denied";
    const onToggleLive = mock(noop);
    const view = render(<InputHarness onToggleLive={onToggleLive} />);
    await flush();

    act(() => changePermission("granted"));
    await flush();

    const goLive = view.getByRole("button", { name: "Go live Desk mic" });
    expect((goLive as HTMLButtonElement).disabled).toBe(false);
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(onToggleLive).not.toHaveBeenCalled();
    fireEvent.click(goLive);
    expect(onToggleLive).toHaveBeenCalledTimes(1);
  });

  test("revoking permission blocks Go live without requesting capture", async () => {
    media.permission = "granted";
    const onToggleLive = mock(noop);
    const view = render(<InputHarness onToggleLive={onToggleLive} />);
    await flush();

    act(() => changePermission("denied"));
    await flush();

    const goLive = view.getByRole("button", { name: "Go live Desk mic" });
    expect((goLive as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(goLive);
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(onToggleLive).not.toHaveBeenCalled();
  });

  test("hot-plug: a device that goes away reads Unplugged, and is offered again when back", async () => {
    media.permission = "granted";
    const view = render(<InputHarness />);
    await flush();

    await act(async () => {
      plug([LINE, USB]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      view.getByText("Unplugged: plug it back in or pick another")
    ).toBeTruthy();

    await act(async () => {
      plug([MIC, LINE, USB]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      view.queryByText("Unplugged: plug it back in or pick another")
    ).toBeNull();
    expect(
      view.getByRole("combobox", { name: "Audio input device" }).textContent
    ).toContain("Desk mic");
  });

  test("hot-plug: unplugging the last input still reads Unplugged", async () => {
    media.permission = "granted";
    const view = render(<InputHarness />);
    await flush();

    await act(async () => {
      plug([USB]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      view.getByText("Unplugged: plug it back in or pick another")
    ).toBeTruthy();
  });

  test("cabled to an output, it says to use headphones and offers echo cancellation", async () => {
    media.permission = "granted";
    const onEchoCancellationChange = mock((_enabled: boolean) => undefined);
    const view = render(
      <InputHarness
        data={inputData({ feedsOutput: true })}
        isPlaying
        onEchoCancellationChange={onEchoCancellationChange}
      />
    );
    await flush();

    expect(
      view.getByText("Use headphones: a mic into speakers can howl")
    ).toBeTruthy();
    expect(view.getByText("Live")).toBeTruthy();
    fireEvent.click(view.getByRole("switch", { name: "Echo cancellation" }));
    expect(onEchoCancellationChange).toHaveBeenCalledWith(true);
  });

  test("the Stage row pauses a live input whose device is unplugged", async () => {
    media.permission = "granted";
    const controls = {
      setPlaying: mock(async (_nodeId: string, _playing: boolean) => undefined),
      setVolume: mock(noop),
      toggleMute: mock(noop),
    };
    setPlaybackChannelRuntime("n:mic", () => ({ isPlaying: true }));
    const radio = deviceInputRadio("mic", {
      channelSelection: { left: 0, right: 1 },
      deviceId: "mic",
      deviceLabel: "Desk mic",
    });
    const view = render(
      <NodeSourceRow
        controls={controls}
        feedback={{ echoCancellation: false }}
        muted={false}
        nodeId="mic"
        radio={radio as never}
        volume={1}
      />
    );
    await flush();
    expect(
      view.getByRole("button", { name: "Mute live Desk mic" })
    ).toBeTruthy();
    expect(controls.setPlaying).not.toHaveBeenCalled();

    await act(async () => {
      plug([LINE, USB]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(controls.setPlaying).toHaveBeenCalledWith("mic", false);
    expect(
      view.getByText("Unplugged: plug it back in or pick another")
    ).toBeTruthy();
  });
});

type OutputData = Parameters<typeof OutputDeviceNodeBody>[0]["data"];

/** The Output device body over the real device hook. */
function OutputHarness({
  data,
  status,
  supported = true,
  mainOutputId = "default",
  onRetry = noop,
}: {
  data: OutputData;
  status?: Parameters<typeof OutputDeviceNodeBody>[0]["status"];
  supported?: boolean;
  mainOutputId?: string;
  onRetry?: () => void;
}) {
  const devices = useNodeDevices();
  return (
    <OutputDeviceNodeBody
      data={data}
      devices={devices}
      mainOutputId={mainOutputId}
      onPickDevice={noop}
      onRemove={noop}
      onRetry={onRetry}
      onToggleMute={noop}
      status={status}
      supported={supported}
    />
  );
}

const usbOut: OutputData = {
  deviceId: "usb",
  deviceLabel: "USB interface",
  muted: false,
  taken: [],
};

describe("Output device node", () => {
  test("names its device, and asks for access to see device names", async () => {
    const view = render(<OutputHarness data={usbOut} />);
    await flush();

    expect(
      view.getByRole("button", { name: "Allow access to see device names" })
    ).toBeTruthy();
  });

  test("a browser without setSinkId says it plays through Speakers", async () => {
    const view = render(<OutputHarness data={usbOut} supported={false} />);
    await flush();

    expect(
      view.getByText(
        "This browser can't choose an output, playing through Speakers"
      )
    ).toBeTruthy();
    expect(view.queryByRole("combobox", { name: "Output device" })).toBeNull();
  });

  test("a rejected sink says so and plays through Speakers", async () => {
    media.permission = "granted";
    const retry = mock(() => undefined);
    const view = render(
      <OutputHarness
        data={usbOut}
        onRetry={retry}
        status={{ message: "Permission denied", state: "failed" }}
      />
    );
    await flush();

    expect(
      view.getByText(
        "Couldn't play here, playing through Speakers: Permission denied"
      )
    ).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry output device" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("an unplugged output says it plays through Speakers", async () => {
    media.permission = "granted";
    media.devices = [
      MIC,
      LINE,
      { deviceId: "default", kind: "audiooutput", label: "Default" },
    ];
    const view = render(<OutputHarness data={usbOut} />);
    await flush();

    expect(view.getByText("Unplugged, playing through Speakers")).toBeTruthy();
  });

  test("the main output's own device reads Same device as Speakers", async () => {
    media.permission = "granted";
    const view = render(<OutputHarness data={usbOut} mainOutputId="usb" />);
    await flush();

    expect(view.getByText("Same device as Speakers")).toBeTruthy();
  });
});
