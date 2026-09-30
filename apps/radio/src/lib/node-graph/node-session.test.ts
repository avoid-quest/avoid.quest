import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  buildMultipleSessionFromRadios,
  getPlaybackSession,
  playbackSessionsCollection,
  updatePlaybackSession,
} from "@/lib/collections/playback-sessions";
import { radiosCollection } from "@/lib/collections/radios";
import { ensureNodePlaybackSession } from "./node-session";

async function reset() {
  await Promise.all([
    playbackSessionsCollection.stateWhenReady(),
    radiosCollection.stateWhenReady(),
  ]);
  for (const id of Array.from(playbackSessionsCollection.state.keys())) {
    playbackSessionsCollection.delete(id);
  }
  for (const id of Array.from(radiosCollection.state.keys())) {
    radiosCollection.delete(id);
  }
}

beforeEach(reset);
afterEach(reset);

const kexp = {
  enabled: true,
  id: "kexp",
  name: "KEXP",
  order: 0,
  streamUrl: "https://radio.example/kexp.mp3",
};

test("builds the node session from enabled stations at their Multiple levels", () => {
  radiosCollection.insert(kexp);
  radiosCollection.insert({
    ...kexp,
    enabled: false,
    id: "off",
    name: "Off",
    order: 1,
    streamUrl: "https://radio.example/off.mp3",
  });
  playbackSessionsCollection.insert(buildMultipleSessionFromRadios([kexp]));
  updatePlaybackSession("multiple", (draft) => {
    draft.masterVolume = 0.4;
    const [channel] = draft.channels;
    if (channel) {
      channel.volume = 0.25;
    }
  });

  ensureNodePlaybackSession();

  const session = getPlaybackSession("node");
  expect(session?.masterVolume).toBe(0.4);
  expect(session?.graph?.nodes.map((node) => node.id)).toEqual([
    "src-kexp",
    "speakers",
  ]);
  expect(session?.channels.map((channel) => channel.volume)).toEqual([0.25]);
});

test("leaves an existing node session alone", () => {
  ensureNodePlaybackSession();
  const first = getPlaybackSession("node");
  radiosCollection.insert(kexp);

  ensureNodePlaybackSession();

  expect(getPlaybackSession("node")).toEqual(first);
  expect(first?.graph?.nodes.map((node) => node.type)).toEqual(["speakers"]);
});
