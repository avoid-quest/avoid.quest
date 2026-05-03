import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createDefaultChannel,
  getPlaybackSession,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import {
  mergeMultiplePlaybackRadios,
  syncMultiplePlaybackChannels,
} from "./playback-actions-multiple";

async function resetPlaybackSessions() {
  await playbackSessionsCollection.stateWhenReady();

  for (const sessionId of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(sessionId);
  }
}

beforeEach(async () => {
  await resetPlaybackSessions();
});

afterEach(async () => {
  await resetPlaybackSessions();
});

describe("syncMultiplePlaybackChannels", () => {
  test("preserves session-only radios when syncing saved radios", async () => {
    await playbackSessionsCollection.stateWhenReady();

    playbackSessionsCollection.insert({
      id: "multiple",
      channels: [
        {
          ...createDefaultChannel("multi:saved-1", "multiple", 0),
          radio: {
            id: "saved-1",
            name: "Saved",
            streamUrl: "https://radio.example/saved.mp3",
          },
        },
        {
          ...createDefaultChannel("multi:rg_session-1", "multiple", 1),
          radio: {
            id: "rg_session-1",
            name: "Session",
            streamUrl: "https://radio.example/session.mp3",
          },
          volume: 0.35,
        },
      ],
      masterVolume: 1,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });

    syncMultiplePlaybackChannels(
      mergeMultiplePlaybackRadios(
        [
          {
            id: "saved-1",
            name: "Saved",
            streamUrl: "https://radio.example/saved.mp3",
          },
        ],
        [
          {
            id: "rg_session-1",
            name: "Session",
            streamUrl: "https://radio.example/session.mp3",
          },
        ]
      )
    );

    expect(
      getPlaybackSession("multiple")?.channels.map((channel) => channel.id)
    ).toEqual(["multi:saved-1", "multi:rg_session-1"]);
    expect(getPlaybackSession("multiple")?.channels[1]?.volume).toBe(0.35);
  });

  test("removes session-only radios after they leave the merged radio set", async () => {
    await playbackSessionsCollection.stateWhenReady();

    playbackSessionsCollection.insert({
      id: "multiple",
      channels: [
        {
          ...createDefaultChannel("multi:saved-1", "multiple", 0),
          radio: {
            id: "saved-1",
            name: "Saved",
            streamUrl: "https://radio.example/saved.mp3",
          },
        },
        {
          ...createDefaultChannel("multi:rg_session-1", "multiple", 1),
          radio: {
            id: "rg_session-1",
            name: "Session",
            streamUrl: "https://radio.example/session.mp3",
          },
        },
      ],
      masterVolume: 1,
      crossfadePosition: 0.5,
      headphoneVolume: 1,
      activeChannelId: null,
    });

    syncMultiplePlaybackChannels([
      {
        id: "saved-1",
        name: "Saved",
        streamUrl: "https://radio.example/saved.mp3",
      },
    ]);

    expect(
      getPlaybackSession("multiple")?.channels.map((channel) => channel.id)
    ).toEqual(["multi:saved-1"]);
  });
});
