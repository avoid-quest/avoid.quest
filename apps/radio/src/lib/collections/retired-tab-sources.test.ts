/**
 * Spotify and Mixcloud were once tab-sharing sources; they are platforms
 * now. What an earlier release stored for them is a plain Browser tab audio
 * capture under their name, so it still loads as one. Saved radios are
 * covered in radios.test.ts; these are the session radios, the DJ decks and
 * the Node patch.
 */

import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import { compile } from "@/lib/node-graph/compile";
import { nodeGraphSchema } from "@/lib/node-graph/schema";
import { buildNodeGraphFromTemplate } from "@/lib/node-graph/templates";
import {
  createDefaultChannel,
  DECK_A_CHANNEL_ID,
  DECK_B_CHANNEL_ID,
  normalizeRadio,
  parsePlaybackSessionRecord,
} from "./playback-sessions";
import { addSessionRadio, getSessionRadios } from "./session-radios";

function sharedTab(label: string, sourceUrl: string) {
  return {
    capture: "display" as const,
    channelCount: 2,
    channelSelection: { left: 0, right: 1 },
    deviceId: "display",
    deviceLabel: label,
    itemType: "track" as const,
    platform: "device-input" as const,
    sourceUrl,
    url: "" as const,
  };
}

describe("a Spotify or Mixcloud tab saved before both became platforms", () => {
  test("a session radio still loads", () => {
    // As a pasted Mixcloud profile link was kept for the session.
    const sourceUrl = "https://www.mixcloud.com/NTSRadio/";
    const radio: Radio = {
      enabled: true,
      id: `browser-audio:${sourceUrl}`,
      name: "Mixcloud",
      platformMetadata: sharedTab("Mixcloud", sourceUrl),
      streamUrl: "",
    };

    addSessionRadio(radio);

    expect(getSessionRadios().find(({ id }) => id === radio.id)).toEqual(radio);
  });

  test("a DJ deck still loads it", () => {
    // As a deck saved Spotify's library tile, opened on Spotify's home page.
    const radio = {
      description: "Shared tab audio",
      enabled: true,
      id: "device-input-left",
      name: "Spotify",
      platformMetadata: sharedTab("Spotify", "https://open.spotify.com/"),
      streamUrl: "",
    };
    const session = parsePlaybackSessionRecord({
      activeChannelId: null,
      channels: [
        { ...createDefaultChannel(DECK_A_CHANNEL_ID, "deck-a", 0), radio },
        createDefaultChannel(DECK_B_CHANNEL_ID, "deck-b", 1),
      ],
      crossfadePosition: 0.5,
      id: "dj",
    });

    expect(session.channels[0]?.radio).toEqual(radio);
    expect(normalizeRadio(radio)).toEqual(radio);
  });

  test("a Node Audio input still loads and plays as shared tab audio", () => {
    // As Node's palette added Mixcloud's tab-sharing entry.
    const { edges, nodes, ...patch } = buildNodeGraphFromTemplate("blank");
    const speakers = nodes.find((node) => node.type === "speakers");
    if (!speakers) {
      throw new Error("Expected Speakers in the blank patch");
    }
    const graph = nodeGraphSchema.parse({
      ...patch,
      edges: [
        ...edges,
        {
          id: "tab->speakers",
          source: "tab",
          sourceHandle: "out:audio:main",
          target: speakers.id,
          targetHandle: "in:audio:main",
        },
      ],
      nodes: [
        ...nodes,
        {
          data: {
            capture: "display",
            deviceId: "display",
            deviceLabel: "Mixcloud",
            sourceUrl: "https://www.mixcloud.com/",
          },
          id: "tab",
          position: { x: 0, y: 0 },
          type: "deviceIn",
        },
      ],
    });
    const session = parsePlaybackSessionRecord({
      channels: [],
      graph,
      id: "node",
    });

    expect(session.graph?.nodes.find((node) => node.id === "tab")).toEqual(
      graph.nodes.find((node) => node.id === "tab")
    );
    const lane = compile(graph, { crossOriginIsolated: false }).lanes.get(
      "tab"
    );
    expect(lane?.radio).toMatchObject({
      name: "Mixcloud",
      platformMetadata: sharedTab("Mixcloud", "https://www.mixcloud.com/"),
    });
  });
});
