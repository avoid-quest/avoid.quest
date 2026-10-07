import { describe, expect, test } from "bun:test";
import type { EffectType } from "@/lib/audio/dsp/effects/types";
import { withBandCount } from "./branches";
import { createNodeEffectConfig } from "./catalogue";
import {
  graphEdgeSchema,
  graphNodeSchema,
  type NodeGraph,
  type NodeGraphInput,
  type NodeType,
} from "./schema";
import {
  type Connection,
  connectionVerdict,
  findCycles,
  type Issue,
  type IssueCode,
  NODE_BUDGETS,
  parseHandleId,
  SAME_SIDE_MESSAGE,
  type ValidateOptions,
  validate,
  validateConnection,
} from "./validate";

type NodeInput = NodeGraphInput["nodes"][number];
type EdgeInput = NodeGraphInput["edges"][number];

const position = { x: 0, y: 0 };
/** Words a refusal should never use: engine terms and unshipped nodes. */
const JARGON = /patch \w+ into|sidechain|Follower/i;

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

function graph(nodes: NodeInput[], edges: EdgeInput[] = []): NodeGraph {
  // Topology checks also cover incomplete subgraphs and duplicate outputs.
  return {
    edges: edges.map((edge) => graphEdgeSchema.parse(edge)),
    nodes: nodes.map((entry) => graphNodeSchema.parse(entry)),
    version: 2,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** The toast a refused cable shows; null when it connects. */
function refusal(
  patch: Parameters<typeof connectionVerdict>[0],
  connection: Connection,
  options?: ValidateOptions
): string | null {
  const verdict = connectionVerdict(patch, connection, options);
  return verdict.ok ? null : verdict.message;
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

function plug(
  source: string,
  target: string,
  { from = "out:audio:main", to = "in:audio:main" } = {}
): Connection {
  return { source, sourceHandle: from, target, targetHandle: to };
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

  test("audio → sidechain connects from a sum", () => {
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
    expect(check(nodes, edges)).toEqual([]);
  });

  test("audio → sidechain connects from a loose node", () => {
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
    ).toEqual([]);
  });

  test("audio → sidechain connects from a node after the station", () => {
    expect(
      check(
        [
          station("music"),
          station("talk"),
          node("level", "gain"),
          fx("comp", "compressor"),
          speakers,
        ],
        [
          audio("music", "comp"),
          audio("comp", "speakers"),
          audio("talk", "level"),
          audio("level", "speakers"),
          key("level", "comp"),
        ]
      )
    ).toEqual([]);
  });

  test("a key into shared FX connects", () => {
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
    expect(check(nodes, edges)).toEqual([]);
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

  test("audio → control is refused in plain words", () => {
    const issues = validate(
      graph(
        [station("a"), node("cut", "filter")],
        [cable("a", "out:audio:main", "cut", "in:control:cutoff")]
      ),
      { release: "v2" }
    );
    expect(codes(issues)).toEqual(["audio-to-control@a->cut"]);
    expect(issues[0]?.message).toBe("Audio can't turn a knob");
  });

  test("control → key is refused in plain words", () => {
    const issues = validate(
      graph(
        [node("lfo", "lfo"), fx("comp", "compressor")],
        [cable("lfo", "out:control:main", "comp", "in:sidechain:key")]
      ),
      { release: "v2" }
    );
    expect(codes(issues)).toEqual(["kind-mismatch@lfo->comp"]);
    expect(issues[0]?.message).toBe("Only audio can key this effect");
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

  test("a Band Split's ports past its band count are refused", () => {
    const threeBands = {
      data: {
        effect: withBandCount(
          createNodeEffectConfig("frequencySplit", "bands"),
          3
        ),
      },
      id: "bands",
      position,
      type: "frequencySplit",
    } as NodeInput;
    const patch = graph(
      [station("a"), threeBands, speakers],
      [audio("a", "bands")]
    );
    const band = (index: number) => ({
      source: "bands",
      sourceHandle: `out:audio:band-${index}`,
      target: "speakers",
      targetHandle: "in:audio:main",
    });

    expect(connectionVerdict(patch, band(3))).toEqual({ ok: true });
    expect(codes(validateConnection(patch, band(4)))).toEqual([
      "unknown-port@candidate",
    ]);
  });

  test("a module can't feed itself", () => {
    const issues = validate(
      graph(
        [station("a"), fx("comp", "compressor"), speakers],
        [
          audio("a", "comp"),
          audio("comp", "speakers"),
          audio("comp", "comp", { id: "self" }),
        ]
      )
    );
    expect(codes(issues)).toEqual(["self-loop@self"]);
    expect(issues[0]?.message).toBe("A module can't feed itself");
  });

  test("a source takes no audio in, and an output gives none out", () => {
    const issues = validate(
      graph(
        [station("a"), station("b"), fx("comp", "compressor"), speakers],
        [
          audio("a", "b", { id: "into-station" }),
          key("a", "b", "key-station"),
          audio("speakers", "comp", { id: "out-of-speakers" }),
        ]
      )
    );
    expect(codes(issues)).toEqual([
      "no-audio-in@into-station",
      "no-audio-in@key-station",
      "no-out@out-of-speakers",
    ]);
    expect(issues.map((issue) => issue.message)).toEqual([
      "A Station makes its own sound and takes no audio in",
      "A Station makes its own sound and takes no audio in",
      "The sound ends at Speakers; it has no output",
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
  test("an FX input sums several cables", () => {
    expect(
      check(
        [station("a"), station("b"), fx("verb", "cheapReverb"), speakers],
        [audio("a", "verb"), audio("b", "verb"), audio("verb", "speakers")]
      )
    ).toEqual([]);
  });

  test("a key input sums several cables", () => {
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
    ).toEqual([]);
  });

  test("Merge accepts more than eight inputs", () => {
    const sources = range(9).map((index) => station(`s${index}`));
    const edges = range(9).map((index) => audio(`s${index}`, "mix"));
    expect(
      check(
        [...sources, node("mix", "merge"), speakers],
        [...edges, audio("mix", "speakers")]
      )
    ).toEqual([]);
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

  test("several Filters can share a path", () => {
    expect(
      check(
        [station("a"), node("f1", "filter"), node("f2", "filter"), speakers],
        [audio("a", "f1"), audio("f1", "f2"), audio("f2", "speakers")]
      )
    ).toEqual([]);
  });

  test("Filters on parallel branches validate; the compiler places them", () => {
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
    ).toEqual([]);
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

  test("several Pan nodes can share a path, after FX too", () => {
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
    ).toEqual([]);
  });

  test("several effects on one path can have independent keys", () => {
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
    expect(validate(graph(nodes, edges))).toEqual([]);
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

describe("validate: audio inputs and output devices", () => {
  const mic = node("mic", "deviceIn", { deviceId: "usb-mic" });
  const desk = node("desk", "deviceOut", { deviceId: "usb" });
  const io = graph(
    [mic, station("a"), desk, speakers],
    [audio("mic", "speakers"), audio("a", "desk")]
  );

  test("both ship in v1 and take their cables", () => {
    expect(validate(io)).toEqual([]);
  });

  test("an Audio input takes no cable in, and an Output device gives none out", () => {
    expect(connectionVerdict(io, plug("a", "mic"))).toEqual({
      code: "no-audio-in",
      message: "An Audio input makes its own sound and takes no audio in",
      ok: false,
    });
    expect(connectionVerdict(io, plug("desk", "speakers"))).toEqual({
      code: "no-out",
      message: "The sound ends at an Output device; it has no output",
      ok: false,
    });
  });

  test("an Output device takes any number of cables", () => {
    const more = graph(
      [station("a"), station("b"), station("c"), desk],
      [audio("a", "desk"), audio("b", "desk")]
    );
    expect(connectionVerdict(more, plug("c", "desk"))).toEqual({ ok: true });
  });

  test("several Output device nodes can route to the same physical device", () => {
    const twice = graph([
      desk,
      node("booth", "deviceOut", { deviceId: "usb" }),
    ]);
    expect(check(twice.nodes)).toEqual([]);
  });

  test("Output devices with no device picked yet don't clash", () => {
    expect(check([node("one", "deviceOut"), node("two", "deviceOut")])).toEqual(
      []
    );
  });
});

describe("validate: releases", () => {
  test("a branch Merge and a Merge summing stations both ship in v1", () => {
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
    expect(check(bus, busEdges)).toEqual([]);
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
    expect(issues[0]?.message).toBe(
      "That would feed the sound back into itself"
    );
  });

  test("a cable into its own node is a self-loop", () => {
    expect(check([node("g", "gain")], [audio("g", "g")])).toEqual([
      "self-loop@g->g",
    ]);
  });

  test("Station → Reverb → Delay → Reverb flags the closing cable as feedback", () => {
    // Reverb's input is full too, but freeing it wouldn't help.
    const issues = validate(
      graph(
        [station("a"), fx("verb", "cheapReverb"), fx("echo", "delay")],
        [
          audio("a", "verb"),
          audio("verb", "echo"),
          audio("echo", "verb", { id: "back" }),
        ]
      )
    );
    expect(codes(issues)).toEqual(["feedback-needs-loop@back"]);
    expect(issues[0]?.message).toBe(
      "That would feed the sound back into itself"
    );
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

  test("a delay-free cycle beside a Loop cycle still needs a Loop", () => {
    // mix, echo, loop and trim form one component, but mix → echo → trim →
    // mix never passes the Loop, so Web Audio would silence it.
    expect(
      check(
        [
          station("a"),
          node("mix", "merge"),
          fx("echo", "delay"),
          node("loop", "loop"),
          node("trim", "gain"),
          speakers,
        ],
        [
          audio("a", "mix"),
          audio("mix", "echo"),
          audio("echo", "speakers"),
          audio("echo", "loop"),
          audio("loop", "mix"),
          audio("echo", "trim"),
          audio("trim", "mix", { id: "short" }),
        ],
        { release: "v2" }
      )
    ).toEqual(["feedback-needs-loop@short"]);
  });

  test("breaks every cycle in a component, not only the last", () => {
    // Both cycles share mix, so they are one component; refusing only the
    // last cable would leave mix → echo → mix standing.
    expect(
      check(
        [
          station("a"),
          node("mix", "merge"),
          fx("echo", "delay"),
          node("trim", "gain"),
          speakers,
        ],
        [
          audio("a", "mix"),
          audio("mix", "echo"),
          audio("echo", "speakers"),
          audio("echo", "mix", { id: "back" }),
          audio("mix", "trim"),
          audio("trim", "mix", { id: "trim-back" }),
        ]
      )
    ).toEqual(["feedback-needs-loop@trim-back", "feedback-needs-loop@back"]);
  });

  test("a downstream key closes an audio feedback cycle", () => {
    // The key carries what its point carries, so it feeds the FX back.
    expect(
      check(
        [
          station("talk"),
          fx("comp", "compressor"),
          node("g", "gain"),
          speakers,
        ],
        [
          audio("talk", "comp"),
          audio("comp", "g"),
          audio("g", "speakers"),
          key("g", "comp"),
        ]
      )
    ).toEqual(["feedback-needs-loop@g->comp"]);
  });

  test("mutually keyed effect outputs form an audio feedback cycle", () => {
    expect(
      check(
        [
          station("a"),
          station("b"),
          fx("ca", "compressor"),
          fx("cb", "compressor"),
          speakers,
        ],
        [
          audio("a", "ca"),
          audio("b", "cb"),
          audio("ca", "speakers"),
          audio("cb", "speakers"),
          key("ca", "cb"),
          key("cb", "ca"),
        ]
      )
    ).toEqual(["feedback-needs-loop@cb->ca"]);
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

  test("accepts a second station into a Merge closing a Split", () => {
    const merged = graph(
      [
        station("a"),
        station("b"),
        fx("split", "fxComposite"),
        node("mix", "merge"),
        speakers,
      ],
      [
        audio("a", "split"),
        audio("split", "mix", { from: "branch-1" }),
        audio("split", "mix", { from: "branch-2", id: "branch-2" }),
        audio("mix", "speakers"),
        audio("b", "speakers"),
      ]
    );
    const second = {
      source: "b",
      sourceHandle: "out:audio:main",
      target: "mix",
      targetHandle: "in:audio:main",
    };

    expect(validate(merged)).toEqual([]);
    expect(validateConnection(merged, second)).toEqual([]);
    // The same Merge takes more of its own station's branches too.
    expect(
      refusal(merged, {
        ...second,
        source: "split",
        sourceHandle: "out:audio:branch-3",
      })
    ).toBeNull();
  });

  describe("key cables", () => {
    const keyed = graph(
      [
        station("music"),
        station("talk"),
        station("news"),
        fx("comp", "compressor"),
        fx("gate", "gate"),
        fx("loose", "crusher"),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "gate"),
        audio("gate", "speakers"),
        audio("talk", "speakers"),
        audio("news", "speakers"),
        key("talk", "comp"),
      ]
    );
    const keyInto = (source: string, target: string) => ({
      source,
      sourceHandle: "out:audio:main",
      target,
      targetHandle: "in:sidechain:key",
    });

    test("a first key from a station lane connects", () => {
      const unkeyed = {
        ...keyed,
        edges: keyed.edges.filter((edge) => edge.id !== "talk->comp"),
      };
      expect(refusal(unkeyed, keyInto("talk", "comp"))).toBeNull();
    });

    test("a second FX key on the same path connects", () => {
      expect(validateConnection(keyed, keyInto("news", "gate"))).toEqual([]);
    });

    test("a key input sums another cable", () => {
      expect(validateConnection(keyed, keyInto("news", "comp"))).toEqual([]);
    });

    test("a key from a loose node can be connected before a source is added", () => {
      expect(refusal(keyed, keyInto("loose", "gate"))).toBeNull();
    });
  });

  test("keeps its candidate apart from a cable already named candidate", () => {
    const named = graph(
      [station("a"), node("g", "gain"), speakers],
      [
        audio("a", "g"),
        audio("g", "speakers", { id: "candidate" }),
        audio("a", "speakers"),
      ]
    );
    expect(
      codes(
        validateConnection(named, {
          source: "g",
          sourceHandle: "out:audio:main",
          target: "g",
          targetHandle: "in:audio:main",
        })
      )
    ).toEqual(["self-loop@candidate-1"]);
  });

  test("refuses a caller id another cable already has", () => {
    expect(
      codes(
        validateConnection(base, {
          id: "mix->echo",
          source: "a",
          sourceHandle: "out:audio:main",
          target: "speakers",
          targetHandle: "in:audio:main",
        })
      )
    ).toEqual(["duplicate-edge@mix->echo"]);
  });

  test("a second Filter on a path connects", () => {
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
    ).toEqual([]);
  });
});

describe("connectionVerdict", () => {
  const chain = graph(
    [
      station("a"),
      fx("comp", "compressor"),
      fx("verb", "cheapReverb"),
      speakers,
    ],
    [audio("a", "comp"), audio("comp", "speakers")]
  );
  test("allows a cable that fits", () => {
    expect(connectionVerdict(chain, plug("a", "speakers"))).toEqual({
      ok: true,
    });
  });

  test("a Compressor out into its own in is a self-loop", () => {
    expect(connectionVerdict(chain, plug("comp", "comp"))).toEqual({
      code: "self-loop",
      message: "A module can't feed itself",
      ok: false,
    });
  });

  test("the same out → in cable twice is a duplicate", () => {
    expect(connectionVerdict(chain, plug("comp", "speakers"))).toEqual({
      code: "duplicate-edge",
      message: "These are already connected",
      ok: false,
    });
  });

  test("a full input says how many cables it takes", () => {
    // A knob takes one control cable; audio and key inputs sum.
    const controlled = graph(
      [
        station("a"),
        node("cut", "filter"),
        node("one", "lfo"),
        node("two", "lfo"),
      ],
      [control("one", "cut", "cutoff")]
    );
    expect(
      connectionVerdict(
        controlled,
        {
          source: "two",
          sourceHandle: "out:control:main",
          target: "cut",
          targetHandle: "in:control:cutoff",
        },
        { release: "v2" }
      )
    ).toEqual({
      code: "port-max",
      message: "This input takes one cable",
      ok: false,
    });
  });

  test("an occupied audio input takes another cable", () => {
    expect(connectionVerdict(chain, plug("verb", "comp"))).toEqual({
      ok: true,
    });
  });

  test("Station → Reverb → Delay → Reverb refuses the closing cable as feedback", () => {
    const loop = graph(
      [station("a"), fx("verb", "cheapReverb"), fx("echo", "delay"), speakers],
      [audio("a", "verb"), audio("verb", "echo"), audio("echo", "speakers")]
    );
    const back = { ...plug("echo", "verb"), id: "back" };
    expect(connectionVerdict(loop, back)).toEqual({
      code: "feedback-needs-loop",
      message: "That would feed the sound back into itself",
      ok: false,
    });
    expect(codes(validateConnection(loop, back))).toEqual([
      "feedback-needs-loop@back",
    ]);
  });

  test("audio into a knob and control into a key are refused in plain words", () => {
    const wired = graph(
      [
        station("a"),
        node("cut", "filter"),
        node("lfo", "lfo"),
        fx("comp", "compressor"),
      ],
      [audio("a", "cut")]
    );
    const v2 = { release: "v2" } as const;
    expect(
      connectionVerdict(
        wired,
        plug("a", "cut", { to: "in:control:cutoff" }),
        v2
      )
    ).toEqual({
      code: "audio-to-control",
      message: "Audio can't turn a knob",
      ok: false,
    });
    expect(
      connectionVerdict(
        wired,
        plug("lfo", "comp", {
          from: "out:control:main",
          to: "in:sidechain:key",
        }),
        v2
      )
    ).toEqual({
      code: "kind-mismatch",
      message: "Only audio can key this effect",
      ok: false,
    });
  });

  test("a source takes no audio in, and Speakers give none out", () => {
    expect(connectionVerdict(chain, plug("comp", "a"))).toMatchObject({
      code: "no-audio-in",
      ok: false,
    });
    expect(connectionVerdict(chain, plug("speakers", "verb"))).toMatchObject({
      code: "no-out",
      ok: false,
    });
  });

  test("two outputs refuse without validating", () => {
    expect(
      connectionVerdict(chain, plug("a", "comp", { to: "out:audio:main" }))
    ).toEqual({
      code: "bad-handle",
      message: SAME_SIDE_MESSAGE,
      ok: false,
    });
  });
});

describe("validate: messages", () => {
  // Every problem the validator raises, as the interface says it. The
  // compiler's own codes (split-depth and on) are covered in
  // compile.test.ts.
  type ValidatorCode = Exclude<
    IssueCode,
    "split-depth" | "split-branches" | "split-open"
  >;
  const v2 = { release: "v2" } as const;
  const scenarios: Issue[][] = [
    validate(
      graph(
        [station("a"), node("cut", "filter"), node("lfo", "lfo")],
        [control("lfo", "cut", "cutoff")]
      )
    ),
    validateConnection(graph([station("a")]), {
      source: "a",
      sourceHandle: "out:audio:main",
      target: "gone",
      targetHandle: "in:audio:main",
    }),
    validate(
      graph(
        [
          station("a"),
          station("b"),
          fx("verb", "cheapReverb"),
          node("lfo", "lfo"),
          node("midi", "midiIn"),
          node("macro", "macro"),
          node("cut", "filter"),
          fx("comp", "compressor"),
          speakers,
          node("more", "speakers"),
        ],
        [
          cable("a", "out:audio", "speakers", "in:audio:main", "short"),
          cable("a", "out:audio:main", "verb", "in:sidechain:key", "no-key"),
          audio("verb", "verb", { id: "self" }),
          audio("a", "b", { id: "in" }),
          audio("speakers", "verb", { id: "out" }),
          cable("lfo", "out:control:main", "speakers", "in:audio:main", "c-a"),
          cable("lfo", "out:control:main", "comp", "in:sidechain:key", "c-k"),
          cable("midi", "out:midi:cc", "cut", "in:control:cutoff", "m-c"),
          cable("a", "out:audio:main", "macro", "in:midi:main", "a-m"),
          cable("a", "out:audio:main", "cut", "in:control:cutoff", "a-c"),
          audio("a", "speakers"),
          audio("a", "speakers", { id: "again" }),
          audio("a", "verb"),
          audio("b", "verb"),
        ]
      ),
      v2
    ),
    validate(
      graph(
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
    ),
    validate(
      graph(
        [node("cut", "filter"), node("one", "lfo"), node("two", "lfo")],
        [control("one", "cut", "cutoff"), control("two", "cut", "cutoff")]
      ),
      v2
    ),
    validate(
      graph(
        [
          station("a"),
          station("b"),
          station("music"),
          station("talk"),
          node("bus", "merge"),
          fx("comp", "compressor"),
          fx("gate", "gate"),
          speakers,
        ],
        [
          audio("a", "bus"),
          audio("b", "bus"),
          audio("bus", "gate"),
          audio("gate", "speakers"),
          audio("music", "comp"),
          audio("comp", "speakers"),
          key("bus", "comp"),
          key("talk", "gate"),
        ]
      ),
      v2
    ),
    validate(
      graph(
        [
          station("a"),
          station("talk"),
          node("f1", "filter"),
          node("f2", "filter"),
          node("p1", "pan"),
          node("p2", "pan"),
          fx("comp", "compressor"),
          fx("gate", "gate"),
          speakers,
        ],
        [
          audio("a", "f1"),
          audio("f1", "f2"),
          audio("f2", "p1"),
          audio("p1", "p2"),
          audio("p2", "comp"),
          audio("comp", "gate"),
          audio("gate", "speakers"),
          key("talk", "comp"),
          key("talk", "gate", "talk~>gate"),
        ]
      )
    ),
    validate(
      graph(
        [station("a"), node("mix", "merge"), fx("echo", "delay")],
        [audio("a", "mix"), audio("mix", "echo"), audio("echo", "mix")]
      )
    ),
    validate(
      graph(
        [node("lfo1", "lfo"), node("lfo2", "lfo")],
        [control("lfo1", "lfo2", "rate"), control("lfo2", "lfo1", "rate")]
      ),
      v2
    ),
    validate(graph([...range(7).map((index) => station(`s${index}`))], []), {
      playing: range(7).map((index) => `s${index}`),
    }),
    validate(graph(range(25).map((index) => station(`s${index}`)))),
    validate(
      graph([
        ...range(5).map((index) => node(`loop${index}`, "loop")),
        ...range(3).map((index) => node(`warp${index}`, "tapeWarp")),
        ...range(9).map((index) => node(`lfo${index}`, "lfo")),
      ]),
      v2
    ),
    validate(
      graph(
        [station("a"), station("b"), node("mix", "merge"), speakers],
        [audio("a", "mix"), audio("b", "mix"), audio("mix", "speakers")]
      )
    ),
    // The schema caps a Tape Warp at 30 s, so only a phone's cap can bite.
    validate(graph([node("long", "tapeWarp", { time: 20 })]), {
      ...v2,
      profile: "mobile",
    }),
    validate(
      graph(
        [station("a"), ...range(65).map((index) => node(`g${index}`, "gain"))],
        range(65).map((index) => audio("a", `g${index}`, { id: `e${index}` }))
      )
    ),
    validate(
      graph([
        node("desk", "deviceOut", { deviceId: "usb" }),
        node("booth", "deviceOut", { deviceId: "usb" }),
      ])
    ),
  ];
  const messages: Partial<Record<IssueCode, string[]>> = {};
  for (const issue of scenarios.flat()) {
    const seen = messages[issue.code] ?? [];
    if (!seen.includes(issue.message)) {
      messages[issue.code] = [...seen, issue.message];
    }
  }

  test("every validator code says what went wrong in plain words", () => {
    expect(messages).toEqual({
      "audio-to-control": ["Audio can't turn a knob"],
      "bad-handle": ["Cable has a malformed port id"],
      "budget-edges": ["Up to 64 cables per patch"],
      "budget-lfos": ["Up to 8 LFOs per patch"],
      "budget-loops": ["Up to 4 Loops per patch"],
      "budget-playing": ["Up to 6 streams can play at once"],
      "budget-sources": ["Up to 24 sources per patch"],
      "budget-tape-warp": ["Up to 2 Tape Warp per patch"],
      "budget-tape-warp-time": ["Tape Warp is limited to 10 s here"],
      "control-cycle": ["That would feed the control back into itself"],
      "duplicate-edge": ["These are already connected"],
      "feedback-needs-loop": ["That would feed the sound back into itself"],
      "kind-mismatch": [
        "Only sound goes in here",
        "Only audio can key this effect",
        "Only a control cable turns this knob",
        "Only MIDI goes in here",
      ],
      "missing-node": ["Cable points at a missing node"],
      "no-audio-in": ["A Station makes its own sound and takes no audio in"],
      "no-out": ["The sound ends at Speakers; it has no output"],
      "one-speakers": ["A patch has one Speakers"],
      "port-max": ["This input takes one cable"],
      "self-loop": ["A module can't feed itself"],
      "unknown-port": ["Cable points at a missing port"],
      unshipped: ["LFO isn't available yet", "Cutoff isn't available yet"],
    } satisfies Record<ValidatorCode, string[]>);
  });

  test("no message leans on jargon or on nodes that haven't shipped", () => {
    for (const message of Object.values(messages).flat()) {
      expect(message).not.toMatch(JARGON);
    }
  });
});

describe("validate: budgets", () => {
  test("the budget table matches the proposal", () => {
    expect(NODE_BUDGETS).toEqual({
      desktop: {
        edges: 64,
        lfos: 8,
        loops: 4,
        playingStreams: 6,
        sources: 24,
        tapeWarpSeconds: 30,
        tapeWarps: 2,
      },
      mobile: {
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
