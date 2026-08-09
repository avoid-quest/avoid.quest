import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import {
  type ManagedRestoreCandidate,
  mergeMultiplePlaybackRadios,
  planManagedSessionRestore,
} from "./managed-playback-session-workflow-policy.js";

function station(id: string): Radio {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: `https://radio.example/${id}.mp3`,
  };
}

describe("managed playback session policy", () => {
  test("restores only the active Single channel", () => {
    const candidates: ManagedRestoreCandidate[] = [
      { channelId: "single-a", radio: station("active") },
      { channelId: "single-b", radio: station("standby") },
    ];

    expect(planManagedSessionRestore("single", "single-a", candidates)).toEqual(
      [{ channelId: "single-a", radio: station("active"), type: "create" }]
    );
  });

  test("keeps live sounds and resets non-restorable channels", () => {
    const localFile = {
      ...station("local"),
      platformMetadata: { platform: "local-file" },
    } as Radio;

    expect(
      planManagedSessionRestore("multiple", null, [
        { channelId: "live", radio: station("live"), soundId: "sound:live" },
        { channelId: "new", radio: station("new") },
        { channelId: "local", radio: localFile, soundId: "sound:local" },
        { channelId: "empty", radio: null },
      ])
    ).toEqual([
      { channelId: "new", radio: station("new"), type: "create" },
      { channelId: "local", cleanupSound: true, type: "reset" },
      { channelId: "empty", cleanupSound: false, type: "reset" },
    ]);
  });

  test("merges persisted Multiple radios without duplicating current radios", () => {
    const current = station("current");
    const persisted = station("persisted");

    expect(
      mergeMultiplePlaybackRadios(
        [current],
        [{ ...current, name: "Persisted copy" }, persisted]
      )
    ).toEqual([current, persisted]);
  });
});
