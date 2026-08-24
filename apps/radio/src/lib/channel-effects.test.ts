import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio";
import {
  createDefaultChannel,
  getPlaybackChannel,
  playbackSessionsCollection,
} from "@/lib/collections/playback-sessions";
import {
  createChannelEffects,
  type DesiredEffectsState,
  type EffectsRuntimeOutcome,
} from "./channel-effects";

async function resetPlaybackSessions(): Promise<void> {
  await playbackSessionsCollection.stateWhenReady();
  for (const sessionId of playbackSessionsCollection.state.keys()) {
    playbackSessionsCollection.delete(sessionId);
  }
}

function insertDjSession(): void {
  playbackSessionsCollection.insert({
    id: "dj",
    channels: [
      createDefaultChannel("deck-a", "deck-a", 0),
      createDefaultChannel("deck-b", "deck-b", 1),
    ],
    masterVolume: 1,
    crossfadePosition: 0.5,
    headphoneVolume: 1,
    activeChannelId: null,
    tempo: 120,
  });
}

const readyCompatibility = (): EffectsRuntimeOutcome => ({
  backend: "compatibility",
  ready: true,
  status: "ready",
});

beforeEach(resetPlaybackSessions);

describe("ChannelEffects", () => {
  test("persists and reconciles one normalized desired Effects tree", async () => {
    insertDjSession();
    const snapshots: DesiredEffectsState[] = [];
    const runtime = {
      reconcile: mock((_soundId: string, desired: DesiredEffectsState) => {
        snapshots.push(desired);
        return Promise.resolve(readyCompatibility());
      }),
    };
    const effects = createChannelEffects({ runtime });
    await effects.bind({ sessionId: "dj", channelId: "deck-a" }, "sound-a");

    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      {
        type: "add",
        effect: createDefaultEffectConfig("delay", "delay-1", 99),
      }
    );
    const result = await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      {
        type: "add",
        effect: createDefaultEffectConfig("limiter", "limiter-1", 99),
      }
    );

    expect(result.desired.tree.map(({ id, order }) => ({ id, order }))).toEqual(
      [
        { id: "delay-1", order: 0 },
        { id: "limiter-1", order: 1 },
      ]
    );
    expect(getPlaybackChannel("dj", "deck-a")?.effects).toEqual([
      ...result.desired.tree,
    ]);
    expect(snapshots.at(-1)).toEqual(result.desired);
    expect(result.runtime).toEqual(readyCompatibility());
  });

  test("rewrites nested mutations through one normalized root tree", async () => {
    insertDjSession();
    const runtime = {
      reconcile: mock(() => Promise.resolve(readyCompatibility())),
    };
    const effects = createChannelEffects({ runtime });
    const root = createDefaultEffectConfig("fxComposite", "root", 0);
    const chainId = root.chains[0]?.id;
    expect(chainId).toBeDefined();
    if (!chainId) {
      return;
    }
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "add", effect: root }
    );
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      {
        type: "add",
        chainId,
        effect: createDefaultEffectConfig("delay", "delay", 42),
      }
    );
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      {
        type: "add",
        chainId,
        effect: createDefaultEffectConfig("limiter", "limiter", 42),
      }
    );
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      {
        type: "update",
        effectId: "delay",
        patch: { enabled: false },
      }
    );
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      {
        type: "reorder",
        chainId,
        effectIds: ["limiter", "delay"],
      }
    );
    const result = await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "remove", effectId: "delay" }
    );

    const persistedRoot = result.desired.tree[0];
    expect(persistedRoot).toMatchObject({ id: "root", order: 0 });
    expect(
      persistedRoot && "chains" in persistedRoot
        ? persistedRoot.chains[0]?.effects
        : undefined
    ).toEqual([expect.objectContaining({ id: "limiter", order: 0 })]);
    expect(getPlaybackChannel("dj", "deck-a")?.effects).toEqual([
      ...result.desired.tree,
    ]);
  });

  test("updates container chain controls without exposing root rewriting", async () => {
    insertDjSession();
    const effects = createChannelEffects({
      runtime: {
        reconcile: mock(() => Promise.resolve(readyCompatibility())),
      },
    });
    const root = createDefaultEffectConfig("fxComposite", "root", 0);
    const chainId = root.chains[0]?.id;
    expect(chainId).toBeDefined();
    if (!chainId) {
      return;
    }
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "add", effect: root }
    );

    const result = await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      {
        type: "update-chain",
        chainId,
        effectId: root.id,
        patch: { gain: 1.5, pan: -0.25 },
      }
    );

    const persistedRoot = result.desired.tree[0];
    expect(
      persistedRoot && "chains" in persistedRoot
        ? persistedRoot.chains[0]
        : undefined
    ).toMatchObject({ gain: 1.5, pan: -0.25 });
  });

  test("reconciles dry wet and tempo from persisted state", async () => {
    insertDjSession();
    const snapshots = new Map<string, DesiredEffectsState>();
    const runtime = {
      reconcile: mock((soundId: string, desired: DesiredEffectsState) => {
        snapshots.set(soundId, desired);
        return Promise.resolve(readyCompatibility());
      }),
    };
    const effects = createChannelEffects({ runtime });
    await effects.bind({ sessionId: "dj", channelId: "deck-a" }, "sound-a");
    await effects.bind({ sessionId: "dj", channelId: "deck-b" }, "sound-b");

    const dryWet = await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "set-dry-wet", value: 0.35 }
    );
    const tempo = await effects.setTempo("dj", 140);

    expect(dryWet.desired.dryWet).toBe(0.35);
    expect(tempo).toHaveLength(2);
    expect(snapshots.get("sound-a")).toMatchObject({
      dryWet: 0.35,
      tempo: 140,
    });
    expect(snapshots.get("sound-b")).toMatchObject({ tempo: 140 });
  });

  test("rebinds sidechains when a source binds, changes, and unbinds", async () => {
    insertDjSession();
    const snapshots = new Map<string, DesiredEffectsState>();
    const runtime = {
      reconcile: mock((soundId: string, desired: DesiredEffectsState) => {
        snapshots.set(soundId, desired);
        return Promise.resolve(readyCompatibility());
      }),
    };
    const effects = createChannelEffects({ runtime });
    const gate = createDefaultEffectConfig("gate", "gate", 0);
    gate.enabled = true;
    gate.sidechain = { channelId: "deck-b" };
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "add", effect: gate }
    );

    await effects.bind({ sessionId: "dj", channelId: "deck-a" }, "sound-a");
    expect(snapshots.get("sound-a")?.sidechainSoundId).toBeNull();

    await effects.bind({ sessionId: "dj", channelId: "deck-b" }, "sound-b-1");
    expect(snapshots.get("sound-a")?.sidechainSoundId).toBe("sound-b-1");

    await effects.bind({ sessionId: "dj", channelId: "deck-b" }, "sound-b-2");
    expect(snapshots.get("sound-a")?.sidechainSoundId).toBe("sound-b-2");

    effects.unbind({ sessionId: "dj", channelId: "deck-b" });
    await Promise.resolve();
    expect(snapshots.get("sound-a")?.sidechainSoundId).toBeNull();
  });

  test("selects the first enabled sidechain effect", async () => {
    insertDjSession();
    const snapshots = new Map<string, DesiredEffectsState>();
    const effects = createChannelEffects({
      runtime: {
        reconcile: mock((soundId: string, desired: DesiredEffectsState) => {
          snapshots.set(soundId, desired);
          return Promise.resolve(readyCompatibility());
        }),
      },
    });
    const disabledGate = createDefaultEffectConfig("gate", "disabled-gate", 0);
    disabledGate.enabled = false;
    disabledGate.sidechain = { channelId: "deck-a" };
    const enabledGate = createDefaultEffectConfig("gate", "enabled-gate", 1);
    enabledGate.enabled = true;
    enabledGate.sidechain = { channelId: "deck-b" };
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "add", effect: disabledGate }
    );
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "add", effect: enabledGate }
    );

    await effects.bind({ sessionId: "dj", channelId: "deck-a" }, "sound-a");
    await effects.bind({ sessionId: "dj", channelId: "deck-b" }, "sound-b");

    expect(snapshots.get("sound-a")?.sidechainSoundId).toBe("sound-b");
  });

  test("ignores sidechains inside a disabled container", async () => {
    insertDjSession();
    const snapshots = new Map<string, DesiredEffectsState>();
    const effects = createChannelEffects({
      runtime: {
        reconcile: mock((soundId: string, desired: DesiredEffectsState) => {
          snapshots.set(soundId, desired);
          return Promise.resolve(readyCompatibility());
        }),
      },
    });
    const root = createDefaultEffectConfig("fxComposite", "root", 0);
    root.enabled = false;
    const nestedGate = createDefaultEffectConfig("gate", "nested-gate", 0);
    nestedGate.enabled = true;
    nestedGate.sidechain = { channelId: "deck-a" };
    root.chains[0]?.effects.push(nestedGate);
    const activeGate = createDefaultEffectConfig("gate", "active-gate", 1);
    activeGate.enabled = true;
    activeGate.sidechain = { channelId: "deck-b" };
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "replace", tree: [root, activeGate] }
    );

    await effects.bind({ sessionId: "dj", channelId: "deck-a" }, "sound-a");
    await effects.bind({ sessionId: "dj", channelId: "deck-b" }, "sound-b");

    expect(snapshots.get("sound-a")?.sidechainSoundId).toBe("sound-b");
  });

  test("selects sidechains only from audible container branches", async () => {
    insertDjSession();
    const snapshots = new Map<string, DesiredEffectsState>();
    const effects = createChannelEffects({
      runtime: {
        reconcile: mock((soundId: string, desired: DesiredEffectsState) => {
          snapshots.set(soundId, desired);
          return Promise.resolve(readyCompatibility());
        }),
      },
    });
    const root = createDefaultEffectConfig("fxComposite", "root", 0);
    root.enabled = true;
    const template = root.chains[0];
    expect(template).toBeDefined();
    if (!template) {
      return;
    }
    const mutedGate = createDefaultEffectConfig("gate", "muted-gate", 0);
    mutedGate.enabled = true;
    mutedGate.sidechain = { channelId: "deck-a" };
    const nonSoloGate = createDefaultEffectConfig("gate", "non-solo-gate", 0);
    nonSoloGate.enabled = true;
    nonSoloGate.sidechain = { channelId: "deck-a" };
    const zeroGainGate = createDefaultEffectConfig("gate", "zero-gain-gate", 0);
    zeroGainGate.enabled = true;
    zeroGainGate.sidechain = { channelId: "deck-a" };
    const soloGate = createDefaultEffectConfig("gate", "solo-gate", 0);
    soloGate.enabled = true;
    soloGate.sidechain = { channelId: "deck-b" };
    root.chains = [
      {
        ...template,
        id: "muted",
        order: 0,
        muted: true,
        effects: [mutedGate],
      },
      {
        ...template,
        id: "non-solo",
        order: 1,
        effects: [nonSoloGate],
      },
      {
        ...template,
        id: "zero-gain",
        order: 2,
        solo: true,
        gain: 0,
        effects: [zeroGainGate],
      },
      {
        ...template,
        id: "solo",
        order: 3,
        solo: true,
        effects: [soloGate],
      },
    ];
    await effects.change(
      { sessionId: "dj", channelId: "deck-a" },
      { type: "replace", tree: [root] }
    );

    await effects.bind({ sessionId: "dj", channelId: "deck-a" }, "sound-a");
    await effects.bind({ sessionId: "dj", channelId: "deck-b" }, "sound-b");

    expect(snapshots.get("sound-a")?.sidechainSoundId).toBe("sound-b");
  });
});
