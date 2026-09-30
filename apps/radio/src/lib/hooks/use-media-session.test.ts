import { afterEach, describe, expect, test } from "bun:test";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import type { Radio } from "@/lib/audio";
import {
  IDLE_RADIO_DOCUMENT_TITLE,
  RADIO_DOCUMENT_TITLE_SUFFIX,
} from "@/lib/metadata/display";
import { sanitizeForBluetooth, useMediaSession } from "./use-media-session";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

/** Records what the hook hands the platform, like the browser class. */
class MediaMetadataStub {
  artist?: string;
  title?: string;

  constructor(init: MediaMetadataInit = {}) {
    this.artist = init.artist;
    this.title = init.title;
  }
}

const mediaSession: {
  metadata: MediaMetadataStub | null;
  playbackState: MediaSessionPlaybackState;
} = { metadata: null, playbackState: "none" };
Object.defineProperty(dom.window.navigator, "mediaSession", {
  configurable: true,
  value: mediaSession,
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  MediaMetadata: MediaMetadataStub,
  navigator: dom.window.navigator,
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
const { cleanup, renderHook } = await import("@testing-library/react");

afterEach(cleanup);

describe("sanitizeForBluetooth", () => {
  test("strips Arabic characters", () => {
    const input = "Radio AlHara راديو الحارة";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Radio AlHara");
  });

  test("strips emoji", () => {
    const input = "Radio 🎙️ Station 📻";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Radio Station");
  });

  test("handles empty string", () => {
    const result = sanitizeForBluetooth("");
    expect(result).toBe("Radio");
  });

  test("handles whitespace-only string", () => {
    const result = sanitizeForBluetooth("   ");
    expect(result).toBe("Radio");
  });

  test("preserves already-clean string", () => {
    const input = "Classic FM";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Classic FM");
  });

  test("collapses multiple spaces", () => {
    const input = "Radio   Station   Name";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Radio Station Name");
  });

  test("preserves ASCII punctuation and numbers", () => {
    const input = "Radio 101.5 FM - Live";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Radio 101.5 FM - Live");
  });

  test("handles mixed scripts with spaces", () => {
    const input = "BBC Radio  ثى رادیو";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("BBC Radio");
  });

  test("keeps accented letters as their base letter", () => {
    expect(sanitizeForBluetooth("Cliché Toupée")).toBe("Cliche Toupee");
    expect(sanitizeForBluetooth("Se Desbordó el Jardín")).toBe(
      "Se Desbordo el Jardin"
    );
  });

  test("maps typographic punctuation to ASCII", () => {
    expect(sanitizeForBluetooth("GUESTS 113 – Nice Strangers")).toBe(
      "GUESTS 113 - Nice Strangers"
    );
    expect(sanitizeForBluetooth("Summer’s “Last” Sound…")).toBe(
      `Summer's "Last" Sound...`
    );
  });
});

describe("useMediaSession in node mode", () => {
  const radios: Radio[] = [
    { id: "kexp", name: "KEXP", streamUrl: "https://radio.example/kexp.mp3" },
    { id: "nts", name: "NTS 1", streamUrl: "https://radio.example/nts.mp3" },
  ];

  test("reads Node patch with the playing count while the patch plays", () => {
    const view = renderHook(
      ({ playingCount }: { playingCount: number }) =>
        useMediaSession({ mode: "node", playingCount, radios }),
      { initialProps: { playingCount: 2 } }
    );

    expect(document.title).toBe(`Node patch (2)${RADIO_DOCUMENT_TITLE_SUFFIX}`);
    expect(mediaSession.playbackState).toBe("playing");
    expect(mediaSession.metadata?.title).toBe("Node patch");
    expect(mediaSession.metadata?.artist).toBe("2 stations playing");

    view.rerender({ playingCount: 1 });
    expect(document.title).toBe(`Node patch (1)${RADIO_DOCUMENT_TITLE_SUFFIX}`);
    expect(mediaSession.metadata?.artist).toBe("1 station playing");

    view.rerender({ playingCount: 0 });
    expect(document.title).toBe(IDLE_RADIO_DOCUMENT_TITLE);
    expect(mediaSession.playbackState).toBe("paused");
    expect(mediaSession.metadata?.title).toBe("Node patch");
    expect(mediaSession.metadata?.artist).toBeUndefined();

    view.unmount();
    expect(document.title).toBe(IDLE_RADIO_DOCUMENT_TITLE);
    expect(mediaSession.metadata).toBeNull();
  });
});
