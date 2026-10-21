import { expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createDefaultEffectConfig } from "@/lib/audio";
import {
  initializePlaybackSessions,
  updatePlaybackChannel,
} from "@/lib/collections/playback-sessions";
// biome-ignore lint/performance/noNamespaceImport: swap only the MIDI adapter while exercising real deck subscriptions.
import * as midi from "@/lib/midi";
import {
  createMidiControl,
  type MidiBrowserAdapter,
} from "@/lib/midi/midi-control";
import { DjConsoleMobile } from "./dj-console-mobile";
import { DjMidiEffects } from "./dj-midi-effects";
import { installAnimationTestEnvironment } from "./shared/animation-test-utils";

const DECK_A_TAB = /^A/;
const DECK_B_TAB = /^B/;
const ignore = () => undefined;

test("both decks' effect mappings dispatch before and after mobile tab switches", async () => {
  const clock = installAnimationTestEnvironment();
  let receive: ((data: Uint8Array) => void) | undefined;
  const browser: MidiBrowserAdapter = {
    cancelFrame: cancelAnimationFrame,
    isSupported: () => true,
    now: () => performance.now(),
    requestAccess: () =>
      Promise.resolve({
        inputs: () => [
          {
            device: {
              id: "test",
              manufacturer: "Test",
              name: "Test",
              state: "connected",
              type: "input",
            },
            subscribe: (listener) => {
              receive = listener;
              return ignore;
            },
          },
        ],
        subscribeStateChange: () => ignore,
      }),
    requestFrame: (callback) => requestAnimationFrame(callback),
    subscribePermission: () => ignore,
  };
  const effectA = createDefaultEffectConfig("limiter", "effect-a", 0);
  const effectB = createDefaultEffectConfig("limiter", "effect-b", 0);
  const change = mock(async ({ channelId }: { channelId: string }) => ({
    desired: {
      dryWet: 1,
      sidechainSoundId: null,
      tempo: 120,
      tree: [channelId === "deck-a" ? effectA : effectB],
    },
    runtime: { backend: null, ready: false, status: "inactive" as const },
  }));
  const control = createMidiControl({
    browser,
    effects: { change },
    persistence: {
      read: () => ({
        state: {
          activePresetId: null,
          enabled: true,
          mappings: [
            {
              channel: 0,
              control: 21,
              targetId: "deck-a:effect:effect-a:enabled",
              type: "note",
            },
            {
              channel: 0,
              control: 22,
              targetId: "deck-b:effect:effect-b:enabled",
              type: "note",
            },
          ],
        },
        version: 2,
      }),
      write: ignore,
    },
    staticActions: [],
  });
  const getControl = spyOn(midi, "getMidiControl").mockReturnValue(control);
  const queryClient = new QueryClient();
  try {
    await initializePlaybackSessions();
    updatePlaybackChannel("dj", "deck-a", (draft) => {
      draft.radio = null;
      draft.effects = [effectA];
    });
    updatePlaybackChannel("dj", "deck-b", (draft) => {
      draft.radio = null;
      draft.effects = [effectB];
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <DjMidiEffects />
        <DjConsoleMobile
          crossfadePosition={0.5}
          deckACueEnabled={false}
          deckBCueEnabled={false}
          isCueActive={false}
          masterVolume={1}
          onCrossfadeChange={ignore}
          onDeckACueChange={ignore}
          onDeckBCueChange={ignore}
          onMasterVolumeChange={ignore}
          radios={[]}
        />
      </QueryClientProvider>
    );
    control.activateDj();
    await control.connect();
    const playBoth = async () => {
      await act(async () => {
        clock.advance(250);
        receive?.(new Uint8Array([0x90, 21, 127]));
        receive?.(new Uint8Array([0x90, 22, 127]));
        await Promise.resolve();
      });
    };
    await playBoth();
    expect(change).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(view.getByRole("tab", { name: DECK_B_TAB }), {
      button: 0,
      ctrlKey: false,
    });
    await playBoth();
    expect(change).toHaveBeenCalledTimes(4);
    fireEvent.mouseDown(view.getByRole("tab", { name: DECK_A_TAB }), {
      button: 0,
      ctrlKey: false,
    });
    await playBoth();
    expect(change).toHaveBeenCalledTimes(6);
    expect(change.mock.calls.map(([ref]) => ref.channelId)).toEqual([
      "deck-a",
      "deck-b",
      "deck-a",
      "deck-b",
      "deck-a",
      "deck-b",
    ]);
  } finally {
    cleanup();
    queryClient.clear();
    control.cleanup();
    getControl.mockRestore();
    clock.restore();
  }
});
