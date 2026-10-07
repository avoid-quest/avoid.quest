import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  createNodeEffectConfig,
  NODE_DEFINITIONS,
  portHandleId,
} from "@/lib/node-graph/catalogue";
import {
  connectableHandles,
  connectPorts,
  dropOnNode,
  type PaletteFrom,
} from "@/lib/node-graph/palette";
import { nodeGraphSchema } from "@/lib/node-graph/schema";
import {
  type Connection,
  connectionVerdict,
  SAME_SIDE_MESSAGE,
} from "@/lib/node-graph/validate";
import {
  canConnect,
  clearConnectionHints,
  connectionHints,
  readPortHint,
  startConnectionHints,
} from "./connection-hints";

// The module itself, so a spy sees the calls made inside it.
const validateModule = await import("@/lib/node-graph/validate");

const at = { x: 0, y: 0 };

function station(id: string) {
  return {
    data: {
      radio: { id, name: id.toUpperCase(), streamUrl: `https://r.test/${id}` },
    },
    id,
    position: at,
    type: "station" as const,
  };
}

function effect(id: string, type: "compressor" | "cheapReverb" | "delay") {
  return {
    data: { effect: createNodeEffectConfig(type, id) },
    id,
    position: at,
    type,
  };
}

function cable(source: string, target: string, into = "in:audio:main") {
  return {
    id: `${source}->${target}`,
    source,
    sourceHandle: "out:audio:main",
    target,
    targetHandle: into,
  };
}

// KEXP is loose. FIP feeds a Compressor keyed by NTS, so both of its inputs
// are full. A Reverb feeds a Delay, with nothing into either yet.
const graph = nodeGraphSchema.parse({
  edges: [
    cable("fip", "comp"),
    cable("nts", "comp", "in:sidechain:key"),
    cable("comp", "speakers"),
    cable("nts", "speakers"),
    cable("verb", "echo"),
  ],
  nodes: [
    station("kexp"),
    station("fip"),
    station("nts"),
    effect("comp", "compressor"),
    effect("verb", "cheapReverb"),
    effect("echo", "delay"),
    { data: {}, id: "speakers", position: at, type: "speakers" },
  ],
  version: 2,
});

function plug(
  source: string,
  target: string,
  { from = "out:audio:main", to = "in:audio:main" } = {}
): Connection {
  return { source, sourceHandle: from, target, targetHandle: to };
}

afterEach(() => {
  clearConnectionHints();
});

describe("one rule for every way to connect", () => {
  // Each cable is dragged from its output, except where noted.
  const cases: [string, Connection, PaletteFrom["type"], string | null][] = [
    ["Station into Speakers", plug("kexp", "speakers"), "source", null],
    ["Station into a loose FX", plug("kexp", "verb"), "source", null],
    [
      "Compressor into itself",
      plug("comp", "comp"),
      "source",
      "A module can't feed itself",
    ],
    [
      "a cable that is already there",
      plug("comp", "speakers"),
      "source",
      "These are already connected",
    ],
    [
      "Delay back into the Reverb feeding it",
      plug("echo", "verb"),
      "source",
      "That would feed the sound back into itself",
    ],
    [
      "an FX into a Station",
      plug("verb", "fip"),
      "source",
      "A Station makes its own sound and takes no audio in",
    ],
    [
      "Speakers into an FX, dragged from the FX input",
      plug("speakers", "verb"),
      "target",
      "The sound ends at Speakers; it has no output",
    ],
    [
      "an output onto another output",
      plug("kexp", "fip", { to: "out:audio:main" }),
      "source",
      SAME_SIDE_MESSAGE,
    ],
  ];

  test.each(cases)("%s", (_label, connection, dragged, message) => {
    const from: PaletteFrom =
      dragged === "source"
        ? {
            handle: connection.sourceHandle ?? "",
            node: connection.source,
            type: "source",
          }
        : {
            handle: connection.targetHandle ?? "",
            node: connection.target,
            type: "target",
          };
    const [node, handle] =
      dragged === "source"
        ? [connection.target, connection.targetHandle ?? ""]
        : [connection.source, connection.sourceHandle ?? ""];
    const ok = message === null;

    const verdict = connectionVerdict(graph, connection);
    expect(verdict.ok ? null : verdict.message).toBe(message);

    // The canvas, before a drag and during one.
    expect(canConnect(graph, connection)).toBe(ok);
    startConnectionHints(graph, from);
    // A port the node lacks, like a Station's audio input, draws no hint.
    const drawn = NODE_DEFINITIONS[
      graph.nodes.find((entry) => entry.id === node)?.type ?? "speakers"
    ].ports.some((port) => portHandleId(port) === handle);
    expect(
      readPortHint(
        connectionHints.state,
        `${from.node} ${from.handle}`,
        `${node} ${handle}`
      )
    ).toEqual(drawn ? verdict : undefined);
    expect(canConnect(graph, connection)).toBe(ok);
    clearConnectionHints();

    // A drop on the port.
    expect(dropOnNode(graph, from, node, handle)).toMatchObject(
      ok ? { connect: connection } : { refuse: message }
    );

    // The keyboard Connect… dialog.
    const targets =
      connectPorts(graph, from.node).find((port) => port.handle === from.handle)
        ?.targets ?? [];
    expect(targets.some((target) => target.key === `${node} ${handle}`)).toBe(
      ok
    );
  });
});

describe("a full key", () => {
  test("refuses a second key, and a drop on it offers to replace the first", () => {
    const connection = plug("fip", "comp", { to: "in:sidechain:key" });
    expect(connectionVerdict(graph, connection)).toEqual({
      code: "port-max",
      message: "This input takes one cable",
      ok: false,
    });
    expect(canConnect(graph, connection)).toBe(false);
    expect(
      dropOnNode(
        graph,
        { handle: "out:audio:main", node: "fip", type: "source" },
        "comp",
        "in:sidechain:key"
      )
    ).toMatchObject({ replace: { connection, edge: "nts->comp" } });
  });
});

describe("connectableHandles", () => {
  test("validates each port facing the drag once, and no other", () => {
    const spy = spyOn(validateModule, "validateConnection");
    try {
      const verdicts = connectableHandles(graph, {
        handle: "out:audio:main",
        node: "kexp",
        type: "source",
      });
      // Inputs: Compressor in and key, Reverb in, Delay in, Speakers in.
      // The Delay's input sums its Reverb with a new cable.
      expect(spy).toHaveBeenCalledTimes(5);
      expect(
        [...verdicts].filter(([, verdict]) => verdict.ok).map(([key]) => key)
      ).toEqual([
        "verb in:audio:main",
        "echo in:audio:main",
        "speakers in:audio:main",
      ]);
      expect(verdicts.get("fip out:audio:main")).toEqual({
        code: "bad-handle",
        message: SAME_SIDE_MESSAGE,
        ok: false,
      });
    } finally {
      spy.mockRestore();
    }
  });

  test("validates the unchanged patch once for the whole drag", () => {
    const spy = spyOn(validateModule, "validate");
    try {
      const verdicts = connectableHandles(graph, {
        handle: "out:audio:main",
        node: "kexp",
        type: "source",
      });
      // Once with each of the 5 facing ports' cables, once without any.
      expect(spy).toHaveBeenCalledTimes(5 + 1);
      expect(
        [...verdicts].filter(([, verdict]) => verdict.ok).map(([key]) => key)
      ).toEqual([
        "verb in:audio:main",
        "echo in:audio:main",
        "speakers in:audio:main",
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  test("during a drag, isValidConnection validates nothing", () => {
    startConnectionHints(graph, {
      handle: "out:audio:main",
      node: "kexp",
      type: "source",
    });
    const spy = spyOn(validateModule, "validateConnection");
    try {
      for (let move = 0; move < 10; move += 1) {
        canConnect(graph, plug("kexp", "speakers"));
        canConnect(graph, plug("kexp", "comp", { to: "in:sidechain:key" }));
      }
      expect(spy).not.toHaveBeenCalled();
      // A cable that isn't the drag's is checked afresh.
      expect(canConnect(graph, plug("fip", "verb"))).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
