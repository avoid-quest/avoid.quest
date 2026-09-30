/** biome-ignore-all lint/performance/noJsxPropsBind: test harnesses pass inline handlers */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import {
  DEFAULT_INPUT_STRIP,
  DEFAULT_MEDIA_STRIP,
  DEFAULT_STATION_STRIP,
} from "@/lib/node-graph/schema";

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
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  DocumentFragment: dom.window.DocumentFragment,
  document: dom.window.document,
  Element: dom.window.Element,
  getComputedStyle: dom.window.getComputedStyle,
  HTMLElement: dom.window.HTMLElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  IntersectionObserver: ObserverStub,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  MutationObserver: dom.window.MutationObserver,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  navigator: dom.window.navigator,
  ResizeObserver: ObserverStub,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  SVGElement: dom.window.SVGElement,
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
const { AudioManager } = await import("@/lib/audio");
type StripModule = typeof import("./source-strip");
let SourceStrip: StripModule["SourceStrip"];
let CompactSourceStrip: StripModule["CompactSourceStrip"];
let STRIP_CONTROLS: StripModule["STRIP_CONTROLS"];

const unsubscribeMeter = mock(() => undefined);
const subscribeMeter = mock(
  (_soundId: string, _listener: (level: unknown) => void) => unsubscribeMeter
);
const audioManager = spyOn(AudioManager, "getInstance").mockReturnValue({
  getTrackProgress: () => ({ duration: 200, position: 30 }),
  subscribeMeter,
} as unknown as ReturnType<typeof AudioManager.getInstance>);

beforeAll(async () => {
  ({ CompactSourceStrip, SourceStrip, STRIP_CONTROLS } = await import(
    "./source-strip"
  ));
});

afterEach(() => {
  cleanup();
  subscribeMeter.mockClear();
  unsubscribeMeter.mockClear();
});

afterAll(() => {
  audioManager.mockRestore();
});

const noop = () => undefined;

type Kind = keyof StripModule["STRIP_CONTROLS"];

function renderStrip(
  kind: Kind,
  overrides: Partial<Parameters<StripModule["SourceStrip"]>[0]> = {}
) {
  const media =
    kind === "platform" || kind === "file"
      ? {
          canCueListen: false,
          onJumpToCue: noop,
          onSeek: noop,
          onSetCue: noop,
          soundId: "sound",
          strip: DEFAULT_MEDIA_STRIP,
        }
      : undefined;
  let strip: Parameters<StripModule["SourceStrip"]>[0]["strip"] =
    DEFAULT_STATION_STRIP;
  if (media) {
    strip = DEFAULT_MEDIA_STRIP;
  } else if (kind === "deviceIn") {
    strip = DEFAULT_INPUT_STRIP;
  }
  return render(
    <SourceStrip
      input={
        kind === "deviceIn"
          ? {
              canGoLive: true,
              channelSelection: { left: 0, right: 1 },
              echoCancellation: false,
              isLoading: false,
              isPlaying: false,
              onChannelsChange: noop,
              onEchoCancellationChange: noop,
              onToggleLive: noop,
              strip: DEFAULT_INPUT_STRIP,
            }
          : undefined
      }
      kind={kind}
      media={media}
      muted={false}
      onStripChange={noop}
      onToggleMute={noop}
      soundId="sound"
      station={
        kind === "station"
          ? {
              bitrate: 128,
              codec: "MP3",
              format: "hls",
              isBuffering: true,
              isPlaying: true,
            }
          : undefined
      }
      strip={strip}
      target="Source"
      {...overrides}
    />
  );
}

/** What the DOM shows for each control a kind could have. */
function shown(view: ReturnType<typeof renderStrip>) {
  const slider = (name: string) =>
    view.queryByRole("slider", { name }) !== null;
  const button = (name: string) =>
    view.queryByRole("button", { name }) !== null;
  return {
    bitrate: view.queryByText("Bitrate") !== null,
    buffering: view.queryByText("Buffering…") !== null,
    channels: view.queryByRole("combobox", { name: "Input channels" }) !== null,
    codec: view.queryByText("Codec") !== null,
    cue: button("Set cue"),
    echoCancellation: view.queryByText("Echo cancellation") !== null,
    format: view.queryByText("Format") !== null,
    keyLock: button("Key lock Source"),
    loop: button("Loop Source"),
    monitor: button("Go live Source"),
    mute: button("Mute channel Source"),
    pan: slider("Pan Source"),
    seek: slider("Seek position"),
    solo: button("Solo Source"),
    speed: slider("Speed Source"),
    trim: slider("Trim Source"),
  };
}

describe("SourceStrip", () => {
  test.each(["station", "platform", "file", "deviceIn"] as const)(
    "a %s shows exactly the controls its kind has",
    async (kind) => {
      const view = renderStrip(kind);
      // The seek bar appears once the first position poll lands.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      const controls = new Set(STRIP_CONTROLS[kind]);
      const expected = Object.fromEntries(
        Object.keys(shown(view)).map((control) => [
          control,
          controls.has(control as never),
        ])
      );
      expect(shown(view) as Record<string, boolean>).toEqual(expected);
    }
  );

  test("a Station reads its stream: buffering, HLS, bitrate and codec", () => {
    const view = renderStrip("station");
    expect(view.getByText("Buffering…")).toBeTruthy();
    expect(view.getByText("HLS")).toBeTruthy();
    expect(view.getByText("128 kbps")).toBeTruthy();
    expect(view.getByText("MP3")).toBeTruthy();
  });

  test("cue listen shows only when a cue output can play it", () => {
    const media = {
      canCueListen: true,
      onJumpToCue: noop,
      onSeek: noop,
      onSetCue: noop,
      soundId: "sound",
      strip: DEFAULT_MEDIA_STRIP,
    };
    expect(
      renderStrip("file").queryByRole("button", { name: "Cue listen Source" })
    ).toBeNull();
    cleanup();
    expect(
      renderStrip("file", { media }).getByRole("button", {
        name: "Cue listen Source",
      })
    ).toBeTruthy();
  });

  test("the seek bar, Set cue and Cue call through once the track can seek", async () => {
    const onSetCue = mock(() => undefined);
    const onJumpToCue = mock(() => undefined);
    const onSeek = mock((_position: number) => undefined);
    const media = {
      canCueListen: false,
      onJumpToCue,
      onSeek,
      onSetCue,
      soundId: "sound",
      strip: { ...DEFAULT_MEDIA_STRIP, cue: 42 },
    };
    const view = renderStrip("platform", {
      media,
      strip: media.strip,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    act(() => {
      fireEvent.click(view.getByRole("button", { name: "Set cue" }));
      fireEvent.click(view.getByRole("button", { name: "Cue: jump to 0:42" }));
    });
    expect(onSetCue).toHaveBeenCalledTimes(1);
    expect(onJumpToCue).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.keyDown(view.getByRole("slider", { name: "Seek position" }), {
        key: "ArrowRight",
      });
    });
    expect(onSeek).toHaveBeenCalledWith(31);
  });

  test("the meter follows the lane's sound and lets go on unmount", () => {
    const view = renderStrip("station", { soundId: "node:n:kexp" });
    expect(subscribeMeter).toHaveBeenCalledWith(
      "node:n:kexp",
      expect.any(Function)
    );
    view.unmount();
    expect(unsubscribeMeter).toHaveBeenCalledTimes(1);
  });

  test("solo and key lock are strip changes", () => {
    const onStripChange = mock((_patch: object) => undefined);
    const view = renderStrip("file", { onStripChange });
    act(() => {
      fireEvent.click(view.getByRole("button", { name: "Solo Source" }));
      fireEvent.click(view.getByRole("button", { name: "Key lock Source" }));
    });
    expect(onStripChange.mock.calls).toEqual([
      [{ solo: true }],
      [{ keyLock: false }],
    ]);
  });
});

describe("CompactSourceStrip", () => {
  test("M, S and pan sit beside the meter and call through", () => {
    const onToggleMute = mock(() => undefined);
    const onToggleSolo = mock(() => undefined);
    const onPanChange = mock((_pan: number) => undefined);
    const view = render(
      <CompactSourceStrip
        muted={false}
        onPanChange={onPanChange}
        onToggleMute={onToggleMute}
        onToggleSolo={onToggleSolo}
        pan={0}
        solo={false}
        soundId="node:n:kexp"
        target="KEXP"
      />
    );
    act(() => {
      fireEvent.click(view.getByRole("button", { name: "Mute channel KEXP" }));
      fireEvent.click(view.getByRole("button", { name: "Solo KEXP" }));
      fireEvent.keyDown(view.getByRole("slider", { name: "Pan KEXP" }), {
        key: "ArrowRight",
      });
    });
    expect(onToggleMute).toHaveBeenCalledTimes(1);
    expect(onToggleSolo).toHaveBeenCalledTimes(1);
    expect(onPanChange).toHaveBeenCalledWith(0.01);
    expect(subscribeMeter).toHaveBeenCalledWith(
      "node:n:kexp",
      expect.any(Function)
    );
    expect(view.getByTitle("Level after the fader")).toBeTruthy();
  });

  test("another source's solo shows this one silenced, S still unpressed", () => {
    const view = render(
      <CompactSourceStrip
        muted={false}
        onPanChange={noop}
        onToggleMute={noop}
        onToggleSolo={noop}
        pan={0}
        solo={false}
        soloedOut
        soundId="node:n:kexp"
        target="KEXP"
      />
    );
    const solo = view.getByRole("button", { name: "Solo KEXP" });
    expect(solo.getAttribute("aria-pressed")).toBe("false");
    expect(solo.getAttribute("title")).toBe(
      "Silenced: another source is soloed"
    );
    expect(
      view.container
        .querySelector('[data-slot="strip-meter"]')
        ?.getAttribute("data-soloed-out")
    ).toBe("true");
  });
});
