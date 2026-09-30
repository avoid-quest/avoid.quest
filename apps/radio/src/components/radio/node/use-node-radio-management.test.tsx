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
import { act } from "react";
import type { Radio } from "@/lib/audio";
import { radiosCollection } from "@/lib/collections/radios";
import { compile, laneChannelId } from "@/lib/node-graph/compile";
import {
  commitNodeGraph,
  createNodeStore,
  type NodeStore,
} from "@/lib/node-graph/node-store";
import type { GraphNode } from "@/lib/node-graph/schema";
import { DEFAULT_STATION_STRIP } from "@/lib/node-graph/schema";
import {
  buildNodeGraphFromTemplate,
  SPEAKERS_NODE_ID,
} from "@/lib/node-graph/templates";
import {
  resetAllPlaybackRuntime,
  resetPlaybackChannelRuntime,
  setPlaybackChannelRuntime,
} from "@/lib/stores/playback-runtime-store";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  navigator: dom.window.navigator,
  sessionStorage: dom.window.sessionStorage,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

// React DOM detects browser input support when it first loads.
const { cleanup, render } = await import("@testing-library/react");

const sessionRadiosState = {
  radios: [] as Radio[],
  removeSessionRadio: mock((_id: string | number) => undefined),
};

mock.module("@/lib/hooks/use-session-radios", () => ({
  isSessionRadio: (radio: Radio) => String(radio.id ?? "").startsWith("rg_"),
  useSessionRadios: <T,>(selector: (state: typeof sessionRadiosState) => T) =>
    selector(sessionRadiosState),
}));

const saveDiscoveredStation = mock((_radio: Radio) => undefined);

mock.module("@/lib/hooks/use-discovered-station-actions", () => ({
  useDiscoveredStationActions: () => ({
    saveDiscoveredStation,
    selectDiscoveredStation: mock((_radio: Radio) => undefined),
  }),
}));

let useNodeRadioManagement: typeof import("./use-node-radio-management")["useNodeRadioManagement"];

beforeAll(async () => {
  ({ useNodeRadioManagement } = await import("./use-node-radio-management"));
});

type Management = ReturnType<typeof useNodeRadioManagement>;

const kexp = {
  enabled: true,
  id: "kexp",
  name: "KEXP",
  order: 0,
  streamUrl: "https://radio.example/kexp.mp3",
} satisfies Radio;
const nts = {
  enabled: true,
  id: "nts",
  name: "NTS 1",
  order: 1,
  streamUrl: "https://radio.example/nts.mp3",
} satisfies Radio;
const discovered = {
  id: "rg_lagos",
  name: "Lagos Talk",
  streamUrl: "https://radio.example/lagos.mp3",
} satisfies Radio;

let store: NodeStore;
const playback = {
  flush: mock(() => undefined),
  setPlaying: mock(async (_nodeId: string, _playing: boolean) => undefined),
};

beforeEach(() => {
  sessionRadiosState.radios = [];
  sessionRadiosState.removeSessionRadio.mockClear();
  saveDiscoveredStation.mockClear();
  playback.flush.mockClear();
  playback.setPlaying.mockClear();
  store = createNodeStore(
    buildNodeGraphFromTemplate("start-from-multiple", { saved: [kexp, nts] })
  );
});

afterEach(() => {
  cleanup();
  resetAllPlaybackRuntime();
  for (const id of Array.from(radiosCollection.state.keys())) {
    radiosCollection.delete(id);
  }
  localStorage.clear();
  sessionStorage.clear();
});

const loaders = {
  createSession: mock(async () => ({
    data: {
      radio: {
        name: "stream.example",
        streamUrl: "https://stream.example/live",
      },
    },
    ok: true as const,
  })),
  loadItem: mock(async () => ({
    radio: {
      id: "yt-abc",
      name: "A video",
      platformMetadata: {
        itemType: "video" as const,
        platform: "youtube" as const,
        url: "https://www.youtube.com/watch?v=abc",
        videoId: "abc",
      },
      streamUrl: "https://media.example/abc.m4a",
    },
    success: true as const,
  })),
};

function TestHarness({
  onRender,
  onStationAdded,
  savedRadios,
}: {
  onRender: (management: Management) => void;
  onStationAdded?: (nodeId: string) => void;
  savedRadios: Radio[];
}) {
  onRender(
    useNodeRadioManagement({
      loaders,
      onStationAdded,
      playback,
      savedRadios,
      store,
    })
  );
  return null;
}

function renderManagement(
  savedRadios: Radio[] = [kexp, nts],
  onStationAdded?: (nodeId: string) => void
) {
  let management: Management | null = null;
  const capture = (next: Management) => {
    management = next;
  };
  const view = render(
    <TestHarness
      onRender={capture}
      onStationAdded={onStationAdded}
      savedRadios={savedRadios}
    />
  );
  return {
    current: () => {
      if (!management) {
        throw new Error("hook did not render");
      }
      return management;
    },
    rerender: (next: Radio[]) =>
      view.rerender(
        <TestHarness
          onRender={capture}
          onStationAdded={onStationAdded}
          savedRadios={next}
        />
      ),
  };
}

function station(id: string) {
  return store.state.graph?.nodes.find(
    (node): node is Extract<GraphNode, { type: "station" }> =>
      node.id === id && node.type === "station"
  );
}

function edgeIds() {
  return store.state.graph?.edges.map((edge) => edge.id) ?? [];
}

describe("useNodeRadioManagement", () => {
  test("edit opens the station dialog, and the Station follows the edit", async () => {
    const hook = renderManagement();

    act(() => hook.current().handleEditRadio(kexp));
    expect(hook.current().dialogOpen).toBe(true);
    expect(hook.current().dialogMode).toBe("edit");
    expect(hook.current().selectedRadio).toBe(kexp);

    const renamed = { ...kexp, name: "KEXP 90.3" };
    await act(async () => {
      hook.rerender([renamed, nts]);
      await Promise.resolve();
    });
    expect(station("src-kexp")?.data.radio?.name).toBe("KEXP 90.3");
  });

  test("delete removes the saved station, then its Station node and cables", async () => {
    radiosCollection.insert(kexp);
    const hook = renderManagement();

    act(() => hook.current().handleDeleteRadio(kexp));
    expect(hook.current().deleteConfirm).toBe(kexp);
    expect(station("src-kexp")).toBeDefined();

    await act(async () => {
      hook.current().confirmDelete();
      await Promise.resolve();
    });
    expect(radiosCollection.state.has("kexp")).toBe(false);
    expect(station("src-kexp")).toBeUndefined();
    expect(edgeIds()).toEqual([`src-nts->${SPEAKERS_NODE_ID}`]);
  });

  test("removing a session station drops its Station without a confirm", async () => {
    sessionRadiosState.radios = [discovered];
    const hook = renderManagement();
    await act(async () => {
      await hook.current().addStation(discovered);
    });
    expect(station("src-rg_lagos")).toBeDefined();

    act(() => hook.current().handleDeleteRadio(discovered));
    expect(hook.current().deleteConfirm).toBeNull();
    expect(sessionRadiosState.removeSessionRadio).toHaveBeenCalledWith(
      "rg_lagos"
    );
    expect(station("src-rg_lagos")).toBeUndefined();
  });

  test("save-discovered saves the session station, and its Station follows the saved id", async () => {
    sessionRadiosState.radios = [discovered];
    const hook = renderManagement();
    await act(async () => {
      await hook.current().addStation(discovered);
    });

    act(() => hook.current().handleSaveSessionRadio(discovered));
    expect(saveDiscoveredStation).toHaveBeenCalledWith(discovered);

    // Saving removes the session copy and adds a saved one under a new id.
    sessionRadiosState.radios = [];
    const saved = { ...discovered, enabled: true, id: "saved-lagos", order: 2 };
    await act(async () => {
      hook.rerender([kexp, nts, saved]);
      await Promise.resolve();
    });
    expect(station("src-rg_lagos")?.data.radio?.id).toBe("saved-lagos");
  });

  test("hide disables the Station node instead of removing it; Undo brings it back playing", async () => {
    setPlaybackChannelRuntime(laneChannelId("src-kexp"), () => ({
      isPlaying: true,
    }));
    const hook = renderManagement();

    await act(async () => {
      await hook.current().handleToggleRadio(kexp, false);
    });
    const { graph } = store.state;
    if (!graph) {
      throw new Error("no graph");
    }
    expect(station("src-kexp")?.data.radio?.enabled).toBe(false);
    expect(edgeIds()).toContain(`src-kexp->${SPEAKERS_NODE_ID}`);
    expect([
      ...compile(graph, { crossOriginIsolated: false }).lanes.keys(),
    ]).toEqual(["src-nts"]);

    // The released lane stops playing.
    resetPlaybackChannelRuntime(laneChannelId("src-kexp"));
    await act(async () => {
      await hook.current().handleToggleRadio(kexp, true);
    });
    expect(station("src-kexp")?.data.radio?.enabled).toBe(true);
    expect(playback.setPlaying).toHaveBeenCalledWith("src-kexp", true);

    playback.setPlaying.mockClear();
    await act(async () => {
      await hook.current().handleToggleRadio(nts, false);
      await hook.current().handleToggleRadio(nts, true);
    });
    expect(playback.setPlaying).not.toHaveBeenCalled();
  });

  test("the search bar adds a Station wired to Speakers and starts it", async () => {
    const onStationAdded = mock((_nodeId: string) => undefined);
    const hook = renderManagement([kexp, nts], onStationAdded);
    const radio3 = {
      enabled: true,
      id: "radio3",
      name: "Radio 3",
      streamUrl: "https://radio.example/radio3.mp3",
    } satisfies Radio;

    await act(async () => {
      const added = hook.current().addStation(radio3);
      // The edit is applied and the start made before any await, inside
      // the click's gesture.
      expect(playback.flush).toHaveBeenCalledTimes(1);
      expect(playback.setPlaying).toHaveBeenCalledWith("src-radio3", true);
      await added;
    });
    expect(edgeIds()).toContain(`src-radio3->${SPEAKERS_NODE_ID}`);
    expect(onStationAdded).toHaveBeenCalledWith("src-radio3");
  });

  test("hide disables every Station holding the station", async () => {
    commitNodeGraph(
      (graph) => ({
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            data: {
              muted: false,
              radio: kexp,
              strip: DEFAULT_STATION_STRIP,
              volume: 1,
            },
            id: "src-kexp-2",
            position: { x: 0, y: 320 },
            type: "station",
          },
        ],
      }),
      store
    );
    setPlaybackChannelRuntime(laneChannelId("src-kexp-2"), () => ({
      isPlaying: true,
    }));
    const hook = renderManagement();

    await act(async () => {
      await hook.current().handleToggleRadio(kexp, false);
    });
    expect(station("src-kexp")?.data.radio?.enabled).toBe(false);
    expect(station("src-kexp-2")?.data.radio?.enabled).toBe(false);

    resetPlaybackChannelRuntime(laneChannelId("src-kexp-2"));
    await act(async () => {
      await hook.current().handleToggleRadio(kexp, true);
    });
    expect(station("src-kexp")?.data.radio?.enabled).toBe(true);
    expect(station("src-kexp-2")?.data.radio?.enabled).toBe(true);
    // Only the one that was playing comes back playing.
    expect(playback.setPlaying.mock.calls).toEqual([["src-kexp-2", true]]);
  });

  test("Radio Browser and Radio Garden picks still fill an empty Station slot", async () => {
    store = createNodeStore(buildNodeGraphFromTemplate("starter"));
    const hook = renderManagement();
    const slot = store.state.graph?.nodes.find(
      (node) => node.type === "station"
    );
    const radioBrowser = {
      id: "rb_1234",
      name: "Radio Browser FM",
      platformMetadata: {
        hls: false,
        itemType: "station" as const,
        platform: "radio-browser" as const,
        stationUuid: "1234",
        url: "https://rb.example/1234",
      },
      streamUrl: "https://rb.example/live.mp3",
    } satisfies Radio;

    await act(async () => {
      await hook.current().fillStation(slot?.id ?? "", radioBrowser);
    });
    expect(station(slot?.id ?? "")?.data.radio?.id).toBe("rb_1234");

    await act(async () => {
      await hook.current().fillSource(slot?.id ?? "", discovered);
    });
    expect(station(slot?.id ?? "")?.data.radio?.id).toBe("rg_lagos");
    expect(playback.setPlaying).toHaveBeenCalledWith(slot?.id, true);
  });

  test("a stream link pasted into a Station becomes a session station", async () => {
    store = createNodeStore(buildNodeGraphFromTemplate("starter"));
    const hook = renderManagement();
    const slotId =
      store.state.graph?.nodes.find((node) => node.type === "station")?.id ??
      "";

    let failure: string | null = "unset";
    await act(async () => {
      failure = await hook
        .current()
        .fillStationFromUrl(slotId, "https://stream.example/live");
    });

    expect(failure).toBeNull();
    expect(loaders.createSession).toHaveBeenCalled();
    expect(station(slotId)?.data.radio).toMatchObject({
      id: "stream.example",
      streamUrl: "https://stream.example/live",
    });
  });

  test("a YouTube link pasted into a Station hands off to a Track", async () => {
    store = createNodeStore(buildNodeGraphFromTemplate("starter"));
    const hook = renderManagement();
    const slotId =
      store.state.graph?.nodes.find((node) => node.type === "station")?.id ??
      "";

    await act(async () => {
      await hook
        .current()
        .fillStationFromUrl(slotId, "https://www.youtube.com/watch?v=abc");
    });

    expect(loaders.loadItem).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc"
    );
    expect(
      store.state.graph?.nodes.find((node) => node.id === slotId)
    ).toMatchObject({ data: { radio: { id: "yt-abc" } }, type: "platform" });
  });
});
