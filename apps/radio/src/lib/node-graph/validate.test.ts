import { describe, expect, test } from "bun:test";
import type { EffectType } from "@/lib/audio/dsp/effects/types";
import { createNodeEffectConfig } from "./catalogue";
import { type NodeGraphInput, type NodeType, nodeGraphSchema } from "./schema";
import {
  findCycles,
  type Issue,
  NODE_BUDGETS,
  parseHandleId,
  type ValidateOptions,
  validate,
  validateConnection,
} from "./validate";

type NodeInput = NodeGraphInput["nodes"][number];
type EdgeInput = NodeGraphInput["edges"][number];

const position = { x: 0, y: 0 };

function station(id: string): NodeInput {
  return {
    data: {
      radio: { id, name: id, streamUrl: `https://example.com/${id}.mp3` },
    },
    id,
    position,
    type: "station",
  };
}

function fx(id: string, type: EffectType): NodeInput {
  return {
    data: { effect: createNodeEffectConfig(type, id) },
    id,
    position,
    type,
  };
}

function node(
  id: string,
  type: Exclude<NodeType, EffectType | "station">,
  data: Record<string, unknown> = {}
): NodeInput {
  return { data, id, position, type } as NodeInput;
}

const speakers = node("speakers", "speakers");

function cable(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  id = `${source}->${target}`
): EdgeInput {
  return { id, source, sourceHandle, target, targetHandle };
}

function audio(
  source: string,
  target: string,
  {
    from = "main",
    to = "main",
    id,
  }: { from?: string; to?: string; id?: string } = {}
): EdgeInput {
  return cable(source, `out:audio:${from}`, target, `in:audio:${to}`, id);
}

function key(source: string, target: string, id?: string): EdgeInput {
  return cable(source, "out:audio:main", target, "in:sidechain:key", id);
}

function control(
  source: string,
  target: string,
  to: string,
  id?: string
): EdgeInput {
  return cable(source, "out:control:main", target, `in:control:${to}`, id);
}

function graph(nodes: NodeInput[], edges: EdgeInput[] = []) {
  return nodeGraphSchema.parse({ edges, nodes, version: 1 });
}

function codes(issues: Issue[]): string[] {
  return issues.map((issue) => `${issue.code}@${issue.id}`);
}

function check(
  nodes: NodeInput[],
  edges: EdgeInput[] = [],
  options?: ValidateOptions
): string[] {
  return codes(validate(graph(nodes, edges), options));
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

describe("parseHandleId", () => {
  test("parses <dir>:<kind>:<name>", () => {
    expect(parseHandleId("in:sidechain:key")).toEqual({
      direction: "in",
      kind: "sidechain",
      name: "key",
    });
    expect(parseHandleId("out:midi:cc")).toEqual({
      direction: "out",
      kind: "midi",
      name: "cc",
    });
  });

  test.each([
    null,
    undefined,
    "",
    "in:audio",
    "in:audio:",
    "up:audio:main",
    "in:video:main",
    "in:audio:main:extra",
  ])("refuses %p", (handle) => {
    expect(parseHandleId(handle)).toBeNull();
  });
});

describe("validate: the migrated Multiple layout", () => {
  test("is clean on desktop and mobile", () => {
    const nodes = [station("a"), station("b"), station("c"), speakers];
    const edges = ["a", "b", "c"].map((id) => audio(id, "speakers"));
    expect(check(nodes, edges)).toEqual([]);
    expect(check(nodes, edges, { profile: "mobile" })).toEqual([]);
  });
});

describe("validate: port kinds", () => {
  test("audio → audio connects", () => {
    expect(
      check(
        [station("a"), fx("verb", "cheapReverb"), speakers],
        [audio("a", "verb"), audio("verb", "speakers")]
      )
    ).toEqual([]);
  });

  test("audio → sidechain connects from a station lane", () => {
    expect(
      check(
        [station("music"), station("talk"), fx("comp", "compressor"), speakers],
        [
          audio("music", "comp"),
          audio("comp", "speakers"),
          key("talk", "comp"),
          audio("talk", "speakers"),
        ]
      )
    ).toEqual([]);
  });

  test("audio → sidechain is refused from a bus", () => {
    const nodes = [
      station("a"),
      station("b"),
      station("music"),
      node("bus", "merge"),
      fx("comp", "compressor"),
      speakers,
    ];
    const edges = [
      audio("a", "bus"),
      audio("b", "bus"),
      audio("bus", "speakers"),
      audio("music", "comp"),
      audio("comp", "speakers"),
      key("bus", "comp"),
    ];
    expect(check(nodes, edges, { release: "v2" })).toEqual([
      "sidechain-source@bus->comp",
    ]);
  });

  test("audio → sidechain is refused from a node outside any lane", () => {
    expect(
      check(
        [
          station("music"),
          fx("loose", "crusher"),
          fx("comp", "gate"),
          speakers,
        ],
        [
          audio("music", "comp"),
          audio("comp", "speakers"),
          key("loose", "comp"),
        ]
      )
    ).toEqual(["sidechain-source@loose->comp"]);
  });

  test("a key into FX on a bus is refused", () => {
    const nodes = [
      station("a"),
      station("b"),
      station("talk"),
      node("bus", "merge"),
      fx("comp", "compressor"),
      speakers,
    ];
    const edges = [
      audio("a", "bus"),
      audio("b", "bus"),
      audio("bus", "comp"),
      audio("comp", "speakers"),
      key("talk", "comp"),
    ];
    expect(check(nodes, edges, { release: "v2" })).toEqual([
      "sidechain-target@talk->comp",
    ]);
  });

  test("control → control connects", () => {
    expect(
      check(
        [station("a"), node("cut", "filter"), node("lfo", "lfo"), speakers],
        [
          audio("a", "cut"),
          audio("cut", "speakers"),
          control("lfo", "cut", "cutoff"),
        ],
        { release: "v2" }
      )
    ).toEqual([]);
  });

  test("midi → midi connects", () => {
    expect(
      check(
        [node("midi", "midiIn"), node("macro", "macro")],
        [cable("midi", "out:midi:cc", "macro", "in:midi:main")],
        { release: "v2" }
      )
    ).toEqual([]);
  });

  test("audio → control is refused with the Follower hint", () => {
    const issues = validate(
      graph(
        [station("a"), node("cut", "filter")],
        [cable("a", "out:audio:main", "cut", "in:control:cutoff")]
      ),
      { release: "v2" }
    );
    expect(codes(issues)).toEqual(["use-follower@a->cut"]);
    expect(issues[0]?.message).toContain("use a Follower");
  });

  test("a Follower bridges audio into control", () => {
    expect(
      check(
        [station("a"), node("follow", "follower"), node("cut", "filter")],
        [audio("a", "follow"), control("follow", "cut", "cutoff")],
        { release: "v2" }
      )
    ).toEqual([]);
  });

  test.each([
    [
      "control → audio",
      cable("lfo", "out:control:main", "speakers", "in:audio:main"),
    ],
    [
      "control → sidechain",
      cable("lfo", "out:control:main", "comp", "in:sidechain:key"),
    ],
    [
      "midi → control",
      cable("midi", "out:midi:cc", "cut", "in:control:cutoff"),
    ],
    ["audio → midi", cable("a", "out:audio:main", "macro", "in:midi:main")],
  ])("%s is refused", (_label, edge) => {
    expect(
      check(
        [
          station("a"),
          node("lfo", "lfo"),
          node("midi", "midiIn"),
          node("macro", "macro"),
          node("cut", "filter"),
          fx("comp", "compressor"),
          speakers,
        ],
        [edge],
        { release: "v2" }
      )
    ).toEqual([`kind-mismatch@${edge.id}`]);
  });

  test("malformed handles and unknown ports are refused", () => {
    expect(
      check(
        [station("a"), fx("verb", "cheapReverb"), speakers],
        [
          cable("a", "in:audio:main", "speakers", "in:audio:main", "backwards"),
          cable("a", "out:audio", "speakers", "in:audio:main", "short"),
          cable("a", "out:audio:main", "verb", "in:sidechain:key", "no-key"),
          cable("a", "out:audio:wet", "speakers", "in:audio:main", "no-out"),
        ]
      )
    ).toEqual([
      "bad-handle@backwards",
      "bad-handle@short",
      "unknown-port@no-key",
      "unknown-port@no-out",
    ]);
  });

  test("ports that land later are refused until their release", () => {
    const nodes = [station("a"), node("cut", "filter"), node("lfo", "lfo")];
    const edges = [control("lfo", "cut", "cutoff")];
    expect(check(nodes, edges)).toEqual([
      "unshipped@lfo",
      "unshipped@lfo->cut",
    ]);
    expect(check(nodes, edges, { release: "v2" })).toEqual([]);
  });

  test("the same cable twice is refused", () => {
    expect(
      check(
        [station("a"), speakers],
        [audio("a", "speakers"), audio("a", "speakers", { id: "again" })]
      )
    ).toEqual(["duplicate-edge@again"]);
  });
});

describe("validate: per-port max", () => {
  test("an FX input takes one cable", () => {
    expect(
      check(
        [station("a"), station("b"), fx("verb", "cheapReverb"), speakers],
        [audio("a", "verb"), audio("b", "verb"), audio("verb", "speakers")]
      )
    ).toEqual(["port-max@b->verb"]);
  });

  test("a key input takes one cable", () => {
    expect(
      check(
        [
          station("music"),
          station("t1"),
          station("t2"),
          fx("comp", "compressor"),
          speakers,
        ],
        [
          audio("music", "comp"),
          audio("comp", "speakers"),
          key("t1", "comp"),
          key("t2", "comp"),
        ]
      )
    ).toEqual(["port-max@t2->comp"]);
  });

  test("Merge takes eight inputs", () => {
    const sources = range(9).map((index) => station(`s${index}`));
    const edges = range(9).map((index) => audio(`s${index}`, "mix"));
    expect(
      check(
        [...sources, node("mix", "merge"), speakers],
        [...edges, audio("mix", "speakers")],
        { release: "v2" }
      )
    ).toEqual(["port-max@s9->mix"]);
  });

  test("Speakers and outputs take any number of cables", () => {
    const sources = range(12).map((index) => station(`s${index}`));
    const toSpeakers = range(12).map((index) => audio(`s${index}`, "speakers"));
    const fanOut = range(3).map((index) =>
      audio("s1", `g${index}`, { id: `fan-${index}` })
    );
    expect(
      check(
        [
          ...sources,
          ...range(3).map((index) => node(`g${index}`, "gain")),
          speakers,
        ],
        [...toSpeakers, ...fanOut]
      )
    ).toEqual([]);
  });
});

describe("validate: one of a kind", () => {
  test("a patch has one Speakers", () => {
    expect(check([speakers, node("more", "speakers")])).toEqual([
      "one-speakers@more",
    ]);
  });

  test("one Filter per lane", () => {
    expect(
      check(
        [station("a"), node("f1", "filter"), node("f2", "filter"), speakers],
        [audio("a", "f1"), audio("f1", "f2"), audio("f2", "speakers")]
      )
    ).toEqual(["lane-filter@f2"]);
  });

  test("one Filter per lane, parallel branches included", () => {
    expect(
      check(
        [
          station("a"),
          fx("split", "fxComposite"),
          node("f1", "filter"),
          node("f2", "filter"),
          node("join", "merge"),
          speakers,
        ],
        [
          audio("a", "split"),
          audio("split", "f1", { from: "branch-1" }),
          audio("split", "f2", { from: "branch-2" }),
          audio("f1", "join"),
          audio("f2", "join"),
          audio("join", "speakers"),
        ]
      )
    ).toEqual(["lane-filter@f2"]);
  });

  test("a Filter in each lane is fine", () => {
    expect(
      check(
        [
          station("a"),
          station("b"),
          node("fa", "filter"),
          node("fb", "filter"),
          speakers,
        ],
        [
          audio("a", "fa"),
          audio("b", "fb"),
          audio("fa", "speakers"),
          audio("fb", "speakers"),
        ]
      )
    ).toEqual([]);
  });

  test("one Pan per lane", () => {
    expect(
      check(
        [
          station("a"),
          node("p1", "pan"),
          fx("verb", "cheapReverb"),
          node("p2", "pan"),
          speakers,
        ],
        [
          audio("a", "p1"),
          audio("p1", "verb"),
          audio("verb", "p2"),
          audio("p2", "speakers"),
        ]
      )
    ).toEqual(["lane-pan@p2"]);
  });

  test("one key per lane", () => {
    const nodes = [
      station("music"),
      station("talk"),
      fx("comp", "compressor"),
      fx("gate", "gate"),
      speakers,
    ];
    const edges = [
      audio("music", "comp"),
      audio("comp", "gate"),
      audio("gate", "speakers"),
      key("talk", "comp"),
      key("talk", "gate", "talk->gate"),
    ];
    const issues = validate(graph(nodes, edges));
    expect(codes(issues)).toEqual(["lane-key@gate"]);
    expect(issues[0]?.message).toBe("One key per lane");
  });

  test("a keyed FX in each lane is fine", () => {
    expect(
      check(
        [
          station("a"),
          station("b"),
          station("talk"),
          fx("ca", "compressor"),
          fx("vb", "vocoder"),
          speakers,
        ],
        [
          audio("a", "ca"),
          audio("b", "vb"),
          audio("ca", "speakers"),
          audio("vb", "speakers"),
          key("talk", "ca"),
          key("talk", "vb"),
        ]
      )
    ).toEqual([]);
  });
});

describe("validate: releases", () => {
  test("an in-lane Merge ships in v1, a bus Merge waits for v2", () => {
    const inLane = [
      [
        station("a"),
        fx("split", "stereoSplit"),
        fx("l", "crusher"),
        fx("r", "fold"),
        node("join", "merge"),
        speakers,
      ],
      [
        audio("a", "split"),
        audio("split", "l", { from: "left" }),
        audio("split", "r", { from: "right" }),
        audio("l", "join"),
        audio("r", "join"),
        audio("join", "speakers"),
      ],
    ] as const;
    expect(check([...inLane[0]], [...inLane[1]])).toEqual([]);

    const bus = [station("a"), station("b"), node("join", "merge"), speakers];
    const busEdges = [
      audio("a", "join"),
      audio("b", "join"),
      audio("join", "speakers"),
    ];
    expect(check(bus, busEdges)).toEqual(["unshipped@join"]);
    expect(check(bus, busEdges, { release: "v2" })).toEqual([]);
  });
});

describe("findCycles", () => {
  test("finds no cycle in a chain or a diamond", () => {
    expect(
      findCycles(
        ["a", "b", "c", "d"],
        [
          { source: "a", target: "b" },
          { source: "a", target: "c" },
          { source: "b", target: "d" },
          { source: "c", target: "d" },
        ]
      )
    ).toEqual([]);
  });

  test("finds each strongly connected component with a cycle", () => {
    const cycles = findCycles(
      ["a", "b", "c", "d", "e", "f"],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "a" },
        { source: "c", target: "d" },
        { source: "d", target: "e" },
        { source: "e", target: "d" },
        { source: "f", target: "f" },
      ]
    );
    expect(cycles.map((cycle) => [...cycle].sort())).toEqual([
      ["d", "e"],
      ["a", "b", "c"],
      ["f"],
    ]);
  });

  test("handles long chains without recursion", () => {
    const ids = range(20_000).map(String);
    const edges = ids.map((id, index) => ({
      source: id,
      target: ids[(index + 1) % ids.length] ?? "1",
    }));
    expect(findCycles(ids, edges)).toHaveLength(1);
  });
});

describe("validate: feedback", () => {
  test("an audio cycle without a Loop needs a Loop", () => {
    const issues = validate(
      graph(
        [station("a"), node("mix", "merge"), fx("echo", "delay"), speakers],
        [
          audio("a", "mix"),
          audio("mix", "echo"),
          audio("echo", "speakers"),
          audio("echo", "mix", { id: "back" }),
        ]
      )
    );
    expect(codes(issues)).toEqual(["feedback-needs-loop@back"]);
    expect(issues[0]?.message).toBe("Feedback needs a Loop");
  });

  test("a cable into its own node needs a Loop", () => {
    expect(check([node("g", "gain")], [audio("g", "g")])).toEqual([
      "feedback-needs-loop@g->g",
    ]);
  });

  test("an audio cycle through a Loop is allowed", () => {
    expect(
      check(
        [
          station("a"),
          node("mix", "merge"),
          fx("echo", "delay"),
          node("loop", "loop"),
          speakers,
        ],
        [
          audio("a", "mix"),
          audio("mix", "echo"),
          audio("echo", "speakers"),
          audio("echo", "loop"),
          audio("loop", "mix"),
        ],
        { release: "v2" }
      )
    ).toEqual([]);
  });

  test("control cycles are refused", () => {
    expect(
      check(
        [node("lfo1", "lfo"), node("lfo2", "lfo")],
        [control("lfo1", "lfo2", "rate"), control("lfo2", "lfo1", "rate")],
        { release: "v2" }
      )
    ).toEqual(["control-cycle@lfo2->lfo1"]);
  });

  test("control cycles are refused even beside a Loop", () => {
    expect(
      check(
        [
          node("loop", "loop"),
          node("clock", "clock"),
          node("rnd", "randomiser"),
          node("title", "titleTrigger"),
        ],
        [control("rnd", "title", "main"), control("title", "rnd", "trigger")],
        { release: "v2" }
      )
    ).toEqual(["control-cycle@title->rnd"]);
  });
});

describe("validateConnection", () => {
  const base = graph(
    [station("a"), node("mix", "merge"), fx("echo", "delay"), speakers],
    [audio("a", "mix"), audio("mix", "echo"), audio("echo", "speakers")]
  );

  test("allows a valid cable", () => {
    expect(
      validateConnection(base, {
        source: "a",
        sourceHandle: "out:audio:main",
        target: "speakers",
        targetHandle: "in:audio:main",
      })
    ).toEqual([]);
  });

  test("refuses the cable that closes a feedback loop", () => {
    expect(
      codes(
        validateConnection(base, {
          source: "echo",
          sourceHandle: "out:audio:main",
          target: "mix",
          targetHandle: "in:audio:main",
        })
      )
    ).toEqual(["feedback-needs-loop@candidate"]);
  });

  test("refuses a missing handle or node", () => {
    expect(
      codes(
        validateConnection(base, {
          source: "a",
          sourceHandle: null,
          target: "speakers",
          targetHandle: "in:audio:main",
        })
      )
    ).toEqual(["bad-handle@candidate"]);
    expect(
      codes(
        validateConnection(base, {
          source: "a",
          sourceHandle: "out:audio:main",
          target: "gone",
          targetHandle: "in:audio:main",
        })
      )
    ).toEqual(["missing-node@candidate"]);
  });

  test("reports lane issues the cable would introduce", () => {
    const twoFilters = graph(
      [station("a"), node("f1", "filter"), node("f2", "filter"), speakers],
      [audio("a", "f1"), audio("f1", "speakers"), audio("f2", "speakers")]
    );
    expect(
      codes(
        validateConnection(twoFilters, {
          source: "f1",
          sourceHandle: "out:audio:main",
          target: "f2",
          targetHandle: "in:audio:main",
        })
      )
    ).toEqual(["lane-filter@f2"]);
  });
});

describe("validate: budgets", () => {
  test("the budget table matches the proposal", () => {
    expect(NODE_BUDGETS).toEqual({
      desktop: {
        buses: 6,
        busesWithFx: 3,
        edges: 64,
        lfos: 8,
        loops: 4,
        playingStreams: 6,
        sources: 24,
        tapeWarpSeconds: 30,
        tapeWarps: 2,
      },
      mobile: {
        buses: 3,
        busesWithFx: 2,
        edges: 64,
        lfos: 8,
        loops: 4,
        playingStreams: 4,
        sources: 24,
        tapeWarpSeconds: 10,
        tapeWarps: 1,
      },
    });
  });

  test.each([
    ["desktop", 6],
    ["mobile", 4],
  ] as const)("%s plays %i streams at once", (profile, limit) => {
    const ids = range(limit + 1).map((index) => `s${index}`);
    const nodes = [...ids.map(station), node("hiss", "static"), speakers];
    const edges = ids.map((id) => audio(id, "speakers"));
    expect(
      check(nodes, edges, {
        playing: [...ids.slice(0, limit), "hiss", ids[limit] ?? ""],
        profile,
        release: "v2",
      })
    ).toEqual([`budget-playing@s${limit + 1}`]);
    expect(
      check(nodes, edges, { playing: ids.slice(0, limit), profile })
    ).toEqual(["unshipped@hiss"]);
  });

  test.each(["desktop", "mobile"] as const)(
    "%s allows 24 sources",
    (profile) => {
      const nodes = range(25).map((index) => station(`s${index}`));
      expect(check(nodes, [], { profile })).toEqual(["budget-sources@s25"]);
      expect(check(nodes.slice(0, 24), [], { profile })).toEqual([]);
    }
  );

  function busPatch(count: number, withFx: boolean) {
    const nodes: NodeInput[] = [speakers];
    const edges: EdgeInput[] = [];
    for (const index of range(count)) {
      nodes.push(
        station(`a${index}`),
        station(`b${index}`),
        node(`bus${index}`, "merge")
      );
      edges.push(
        audio(`a${index}`, `bus${index}`),
        audio(`b${index}`, `bus${index}`)
      );
      if (withFx) {
        nodes.push(fx(`verb${index}`, "cheapReverb"));
        edges.push(
          audio(`bus${index}`, `verb${index}`),
          audio(`verb${index}`, "speakers")
        );
      } else {
        edges.push(audio(`bus${index}`, "speakers"));
      }
    }
    return [nodes, edges] as const;
  }

  test.each([
    ["desktop", 6],
    ["mobile", 3],
  ] as const)("%s allows %i buses", (profile, limit) => {
    const [nodes, edges] = busPatch(limit + 1, false);
    expect(check(nodes, edges, { profile, release: "v2" })).toEqual([
      `budget-buses@bus${limit + 1}`,
    ]);
  });

  test.each([
    ["desktop", 3],
    ["mobile", 2],
  ] as const)("%s allows %i buses with FX", (profile, limit) => {
    const [nodes, edges] = busPatch(limit + 1, true);
    expect(check(nodes, edges, { profile, release: "v2" })).toEqual([
      `budget-bus-fx@bus${limit + 1}`,
    ]);
    const [fewer, fewerEdges] = busPatch(limit, true);
    expect(check(fewer, fewerEdges, { profile, release: "v2" })).toEqual([]);
  });

  test.each(["desktop", "mobile"] as const)("%s allows 4 Loops", (profile) => {
    const nodes = range(5).map((index) => node(`loop${index}`, "loop"));
    expect(check(nodes, [], { profile, release: "v2" })).toEqual([
      "budget-loops@loop5",
    ]);
  });

  test.each([
    ["desktop", 2],
    ["mobile", 1],
  ] as const)("%s allows %i Tape Warp", (profile, limit) => {
    const nodes = range(limit + 1).map((index) =>
      node(`warp${index}`, "tapeWarp")
    );
    expect(check(nodes, [], { profile, release: "v2" })).toEqual([
      `budget-tape-warp@warp${limit + 1}`,
    ]);
  });

  test("Tape Warp time is 30 s on desktop and 10 s on mobile", () => {
    const nodes = [node("warp", "tapeWarp", { time: 20 })];
    expect(check(nodes, [], { profile: "desktop", release: "v2" })).toEqual([]);
    expect(check(nodes, [], { profile: "mobile", release: "v2" })).toEqual([
      "budget-tape-warp-time@warp",
    ]);
    expect(
      check([node("warp", "tapeWarp", { time: 10 })], [], {
        profile: "mobile",
        release: "v2",
      })
    ).toEqual([]);
  });

  test.each(["desktop", "mobile"] as const)("%s allows 8 LFOs", (profile) => {
    const nodes = range(9).map((index) => node(`lfo${index}`, "lfo"));
    expect(check(nodes, [], { profile, release: "v2" })).toEqual([
      "budget-lfos@lfo9",
    ]);
  });

  test.each(["desktop", "mobile"] as const)(
    "%s allows 64 cables",
    (profile) => {
      const gains = range(65).map((index) => node(`g${index}`, "gain"));
      const edges = range(65).map((index) =>
        audio("a", `g${index}`, { id: `e${index}` })
      );
      expect(check([station("a"), ...gains], edges, { profile })).toEqual([
        "budget-edges@e65",
      ]);
      expect(
        check([station("a"), ...gains], edges.slice(0, 64), { profile })
      ).toEqual([]);
    }
  );
});
