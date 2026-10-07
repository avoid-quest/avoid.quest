import { describe, expect, mock, test } from "bun:test";
import type { EffectConfig, EffectType } from "@/lib/audio/dsp/effects/types";
import {
  FakeAudioContext,
  type FakeAudioParam,
  type FakeFilterNode,
  type FakeGainNode,
} from "@/lib/audio/routing/fake-audio-nodes";
import type { EffectsRuntimeOutcome } from "@/lib/channel-effects";
import { createNodeEffectConfig } from "@/lib/node-graph/catalogue";
import {
  compile,
  type EnginePlan,
  endpointKey,
  type UnitPlan,
} from "@/lib/node-graph/compile";
import {
  type NodeGraphInput,
  type NodeType,
  nodeGraphSchema,
} from "@/lib/node-graph/schema";
import { createParameters } from "./params";
import { RoutingGraph } from "./routing";

type NodeInput = NodeGraphInput["nodes"][number];
type EdgeInput = NodeGraphInput["edges"][number];

const position = { x: 0, y: 0 };

function station(id: string): NodeInput {
  return {
    data: { radio: { id, name: id, streamUrl: `https://example.com/${id}` } },
    id,
    position,
    type: "station",
  };
}

function fx(
  id: string,
  type: EffectType,
  overrides: Partial<EffectConfig> = {}
): NodeInput {
  return {
    data: {
      effect: {
        ...createNodeEffectConfig(type, id),
        enabled: true,
        ...overrides,
      },
    },
    id,
    position,
    type,
  } as NodeInput;
}

function node(
  id: string,
  type: Exclude<NodeType, EffectType | "station">,
  data: Record<string, unknown> = {}
): NodeInput {
  return { data, id, position, type } as NodeInput;
}

function audio(
  source: string,
  target: string,
  extra: { gain?: number; muted?: boolean } = {}
): EdgeInput {
  return {
    id: `${source}->${target}`,
    source,
    sourceHandle: "out:audio:main",
    target,
    targetHandle: "in:audio:main",
    ...extra,
  };
}

function plan(nodes: NodeInput[], edges: EdgeInput[]): EnginePlan {
  return compile(nodeGraphSchema.parse({ edges, nodes, version: 2 }), {
    crossOriginIsolated: true,
  });
}

const speakers = node("speakers", "speakers");
const desk = node("desk", "deviceOut", { deviceId: "usb" });

/** Stations a and b into a Merge, through a Compressor, to `outs`. */
function shared(
  outs: EdgeInput[] = [audio("comp", "speakers")],
  comp: Partial<EffectConfig> = {}
) {
  return plan(
    [
      station("a"),
      station("b"),
      node("mix", "merge"),
      fx("comp", "compressor", comp),
      speakers,
      desk,
    ],
    [audio("a", "mix"), audio("b", "mix"), audio("mix", "comp"), ...outs]
  );
}

const ready: EffectsRuntimeOutcome = {
  backend: "official",
  ready: true,
  status: "ready",
};

function createHarness() {
  const context = new FakeAudioContext();
  const waits: { resolve: () => void }[] = [];
  /** What each output takes, by sink id. */
  const sinks = new Map<string, Set<unknown>>();
  let current: EnginePlan | null = null;
  const attached = new Map<string, { input: unknown; output: unknown }>();
  /** Each unit's effects as attached, reconciled or written. */
  const effects = new Map<string, EffectConfig[]>();
  /** Each unit's outcome listeners. */
  const listeners = new Map<string, (outcome: EffectsRuntimeOutcome) => void>();
  let attach = (_id: string): Promise<EffectsRuntimeOutcome> =>
    Promise.resolve(ready);
  /** Keys connected for keyed effects, by key id. */
  const keys = new Map<string, AudioNode>();
  const host = {
    attachEffects: mock(
      (id: string, input: AudioNode, output: AudioNode, unit: UnitPlan) => {
        attached.set(id, { input, output });
        effects.set(id, unit.effects);
        return attach(id);
      }
    ),
    connectKey: mock((id: string, input: AudioNode) => {
      keys.set(id, input);
    }),
    detachEffects: mock((id: string) => {
      attached.delete(id);
    }),
    onFailure: mock(() => undefined),
    outcomeChanged: mock(() => undefined),
    parameters: (id: string, unit: () => UnitPlan, active: () => boolean) =>
      createParameters({
        active,
        audio: {
          getEffectsRuntimeOutcome: () => ready,
          getStripNodes: () => null,
        },
        effects: { setEffectFields: () => "applied" },
        plan: unit,
        soundId: id,
      }),
    reconcileEffects: mock((id: string, unit: UnitPlan) => {
      effects.set(id, unit.effects);
      return Promise.resolve(ready);
    }),
    releaseKey: mock((id: string) => {
      keys.delete(id);
    }),
    routeSink: mock((sinkId: string, send: AudioNode, _realtime: boolean) => {
      const into = sinks.get(sinkId) ?? new Set<unknown>();
      sinks.set(sinkId, into);
      into.add(send);
      return () => {
        into.delete(send);
      };
    }),
    sendOverlay: () => undefined,
    setEffectFields: mock(
      (id: string, effectId: string, config: EffectConfig) => {
        effects.set(
          id,
          (effects.get(id) ?? []).map((effect) =>
            effect.id === effectId ? config : effect
          )
        );
        return "applied" as const;
      }
    ),
    subscribeOutcome: (
      id: string,
      listener: (outcome: EffectsRuntimeOutcome) => void
    ) => {
      listeners.set(id, listener);
      return () => listeners.delete(id);
    },
    wait: (_ms: number) => {
      const pending = Promise.withResolvers<void>();
      waits.push(pending);
      return pending.promise;
    },
  };
  const routing = new RoutingGraph(host);
  const apply = (next: EnginePlan) => {
    current = next;
    routing.apply(next);
  };
  /** A lane's send for each of its cables into a point, as lanes make. */
  const laneSends = (laneId: string) => {
    const held = new Map<string, { gain: FakeGainNode; release: () => void }>();
    for (const cable of current?.cables.values() ?? []) {
      if (cable.from.id === laneId && cable.to.kind !== "sink") {
        const gain = context.createGain() as unknown as FakeGainNode;
        const release = routing.route(
          endpointKey(cable.to),
          gain as unknown as AudioNode,
          false
        );
        held.set(cable.id, { gain, release });
      }
    }
    return held;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Ends every pending fade, then lets each step after it run. */
  const endFades = async () => {
    while (waits.length > 0) {
      for (const pending of waits.splice(0)) {
        pending.resolve();
      }
      // biome-ignore lint/performance/noAwaitInLoops: a fade ending can start the next point's.
      await settle();
    }
  };
  return {
    apply,
    attached,
    context,
    effects,
    endFades,
    host,
    keys,
    laneSends,
    listeners,
    /** Unit attaches answer through `next` from now on. */
    onAttach(next: (id: string) => Promise<EffectsRuntimeOutcome>) {
      attach = next;
    },
    routing,
    settle,
    sinks,
    waits,
  };
}

function lastValue(param: FakeAudioParam | undefined) {
  const last = param?.events.at(-1);
  return last && "value" in last ? last.value : undefined;
}

/** Whether `from` reaches `to` through connected nodes. */
function feeds(from: unknown, to: unknown): boolean {
  return [...((from as FakeGainNode | undefined)?.connections ?? [])].some(
    (next) => next === to || feeds(next, to)
  );
}

describe("RoutingGraph", () => {
  test("a unit's sends move to the other timing when the sources it hears change", async () => {
    const h = createHarness();
    /** The shared plan, its unit heard as only live inputs or not. */
    const timed = (realtime: boolean): EnginePlan => {
      const next = shared();
      for (const unit of next.units.values()) {
        unit.realtime = realtime;
      }
      return next;
    };
    h.apply(timed(true));
    h.laneSends("a");
    await h.settle();
    const [live] = h.sinks.get("speakers") ?? [];

    h.apply(timed(false));

    // The live send fades out while a new one takes the main delay.
    expect(lastValue((live as FakeGainNode).gain)).toBe(0);
    expect(
      h.host.routeSink.mock.calls.map(([sinkId, , realtime]) => [
        sinkId,
        realtime,
      ])
    ).toEqual([
      ["speakers", true],
      ["speakers", false],
    ]);
    await h.endFades();
    expect(h.sinks.get("speakers")?.has(live)).toBe(false);
    expect(h.sinks.get("speakers")?.size).toBe(1);
  });

  test("two sources sum before one shared effect; dry and wet outputs stay distinct", async () => {
    const h = createHarness();
    const next = plan(
      [
        station("a"),
        station("b"),
        node("mix", "merge"),
        fx("comp", "compressor"),
        speakers,
      ],
      [
        audio("a", "speakers"),
        audio("a", "mix", { gain: 0.5 }),
        audio("b", "mix"),
        audio("mix", "comp"),
        audio("comp", "speakers"),
      ]
    );
    h.apply(next);

    const fromA = h.laneSends("a");
    const fromB = h.laneSends("b");
    await h.settle();

    // One unit, its FX attached once, takes both stations at its input.
    expect(h.host.attachEffects).toHaveBeenCalledTimes(1);
    const unit = h.attached.get("node-unit:mix");
    const input = unit?.input as FakeGainNode;
    expect(input.connections.size).toBe(0);
    expect(fromA.get("a->mix")?.gain.connections.has(input)).toBe(true);
    expect(fromB.get("b->mix")?.gain.connections.has(input)).toBe(true);
    // Station a's dry cable is its lane's own; the wet one leaves the unit.
    expect(fromA.has("a->speakers")).toBe(false);
    expect(h.sinks.get("speakers")?.size).toBe(1);
    expect(h.effects.get("node-unit:mix")?.map((effect) => effect.id)).toEqual([
      "comp",
    ]);
  });

  test("muting or deleting one of several sink cables keeps the sink and the other cables", async () => {
    const h = createHarness();
    h.apply(shared([audio("comp", "speakers"), audio("comp", "desk")]));
    h.laneSends("a");
    await h.settle();
    const [toSpeakers] = h.sinks.get("speakers") ?? [];
    const [toDesk] = h.sinks.get("desk") ?? [];

    h.apply(
      shared([
        audio("comp", "speakers"),
        audio("comp", "desk", { muted: true }),
      ])
    );
    expect(lastValue((toDesk as FakeGainNode).gain)).toBe(0);
    expect(lastValue((toSpeakers as FakeGainNode).gain)).toBe(1);

    h.apply(shared([audio("comp", "speakers")]));
    // Still wired while it fades out, so it doesn't click.
    expect(h.sinks.get("desk")?.has(toDesk)).toBe(true);
    await h.endFades();
    expect(h.sinks.get("desk")?.size).toBe(0);
    expect(h.sinks.get("speakers")?.has(toSpeakers)).toBe(true);
    expect(h.host.detachEffects).not.toHaveBeenCalled();
  });

  test("parameter changes reuse units; replacing a module releases only the old one", async () => {
    const h = createHarness();
    const withNative = (native: NodeInput, threshold: number): EnginePlan =>
      plan(
        [
          station("a"),
          station("b"),
          node("mix", "merge"),
          fx("comp", "compressor", { threshold } as Partial<EffectConfig>),
          native,
          speakers,
        ],
        [
          audio("a", "mix"),
          audio("b", "mix"),
          audio("mix", "comp"),
          audio("comp", native.id),
          audio(native.id, "speakers"),
        ]
      );
    h.apply(withNative(node("tone", "filter", { frequency: 500 }), -20));
    h.laneSends("a");
    await h.settle();
    const [filter] = h.context.filters as FakeFilterNode[];
    expect(filter?.frequency.value).toBe(500);

    // A knob turn updates the unit and the filter in place.
    h.apply(withNative(node("tone", "filter", { frequency: 900 }), -30));
    await h.settle();
    expect(h.host.attachEffects).toHaveBeenCalledTimes(1);
    expect(h.effects.get("node-unit:mix")).toEqual([
      expect.objectContaining({ id: "comp", threshold: -30 }),
    ]);
    expect(lastValue(filter?.frequency)).toBe(900);
    expect(h.context.filters).toHaveLength(1);

    // A Pan in the Filter's place: the unit stays, the Filter goes.
    h.apply(withNative(node("width", "pan", { pan: 0.5 }), -30));
    await h.endFades();
    expect(h.context.panners).toHaveLength(1);
    expect(h.host.attachEffects).toHaveBeenCalledTimes(1);
    expect(h.host.detachEffects).not.toHaveBeenCalled();
    expect(filter?.connections.size).toBe(0);
    expect(h.sinks.get("speakers")?.size).toBe(1);
  });

  test("a knob turn on a shared unit writes just that effect's fields", async () => {
    const h = createHarness();
    h.apply(shared([audio("comp", "speakers")], { threshold: -20 }));
    h.laneSends("a");
    await h.settle();

    h.apply(shared([audio("comp", "speakers")], { threshold: -30 }));
    await h.settle();

    // Same layout, backend and key: no tree reconcile, just the fields.
    expect(h.host.reconcileEffects).not.toHaveBeenCalled();
    expect(h.host.setEffectFields).toHaveBeenCalledWith(
      "node-unit:mix",
      "comp",
      expect.objectContaining({ threshold: -30 })
    );
    expect(h.effects.get("node-unit:mix")).toEqual([
      expect.objectContaining({ id: "comp", threshold: -30 }),
    ]);
  });

  test("a unit's attach counts toward settling, and a failed one leaves its tree to reconcile", async () => {
    const h = createHarness();
    const attach = Promise.withResolvers<EffectsRuntimeOutcome>();
    h.onAttach(() => attach.promise);
    h.apply(shared([audio("comp", "speakers")], { threshold: -20 }));
    h.laneSends("a");
    let idle = false;
    h.routing.whenIdle().then(() => {
      idle = true;
    });
    await h.settle();
    expect(h.routing.busy()).toBe(true);
    expect(idle).toBe(false);

    attach.resolve({
      backend: "bypass",
      error: new Error("No Effects runtime became ready"),
      ready: true,
      status: "failed",
    });
    await h.settle();
    expect(idle).toBe(true);

    // The attach may have half-built the tree: a knob turn swaps the whole
    // of it in, under the duck, rather than writing one field into it.
    h.apply(shared([audio("comp", "speakers")], { threshold: -30 }));
    await h.endFades();
    expect(h.host.setEffectFields).not.toHaveBeenCalled();
    expect(h.host.reconcileEffects).toHaveBeenCalledWith(
      "node-unit:mix",
      expect.objectContaining({
        effects: [expect.objectContaining({ threshold: -30 })],
      })
    );
  });

  test("a unit that falls back after it settled shows the backend it fell back to", async () => {
    const h = createHarness();
    h.apply(shared());
    h.laneSends("a");
    await h.settle();
    expect(h.routing.outcomeOf("mix")).toBe("official");

    h.listeners.get("node-unit:mix")?.({
      backend: "compatibility",
      ready: true,
      status: "ready",
    });

    expect(h.routing.outcomeOf("mix")).toBe("compatibility");
    expect(h.host.outcomeChanged).toHaveBeenCalled();
  });

  test("unused points release after the cable fade; a quick reconnect cancels retirement", async () => {
    const h = createHarness();
    h.apply(shared());
    const sends = h.laneSends("a");
    await h.settle();
    const unit = h.attached.get("node-unit:mix");
    const output = (unit?.output as FakeGainNode | undefined)?.connections;
    expect(output?.size).toBe(1);

    // Dropped from the plan, but a lane's cable still holds it.
    h.apply(plan([station("a"), speakers], [audio("a", "speakers")]));
    expect(h.waits).toHaveLength(0);
    await h.endFades();
    expect(h.attached.has("node-unit:mix")).toBe(true);

    // Its last cable lets go: its output fades, then it goes.
    sends.get("a->mix")?.release();
    expect(h.waits).toHaveLength(1);
    // Wanted again before the fade ends: the same unit comes back.
    h.apply(shared());
    await h.endFades();
    expect(h.attached.has("node-unit:mix")).toBe(true);
    expect(h.host.attachEffects).toHaveBeenCalledTimes(1);

    // Dropped again with nothing holding it: it goes after the fade.
    h.apply(plan([station("a"), speakers], [audio("a", "speakers")]));
    expect(h.attached.has("node-unit:mix")).toBe(true);
    await h.endFades();
    expect(h.attached.has("node-unit:mix")).toBe(false);
    expect(h.sinks.get("speakers")?.size).toBe(0);
    await h.routing.whenIdle();
    expect(h.routing.busy()).toBe(false);
  });

  test("swapping two points never feeds back: the new cable joins once the old one has faded", async () => {
    const h = createHarness();
    const chain = (first: NodeInput, second: NodeInput) =>
      plan(
        [
          station("a"),
          fx("comp", "compressor"),
          node("tone", "filter", { frequency: 800 }),
          node("width", "pan", { pan: 0.5 }),
          speakers,
        ],
        [
          audio("a", "comp"),
          audio("comp", first.id),
          audio(first.id, second.id),
          audio(second.id, "speakers"),
        ]
      );
    const tone = node("tone", "filter");
    const width = node("width", "pan");
    h.apply(chain(tone, width));
    h.laneSends("a");
    await h.settle();
    const [filter] = h.context.filters as FakeFilterNode[];
    const [panner] = h.context.panners;
    expect(feeds(filter, panner)).toBe(true);

    // Pan before Filter now: Filter → Pan fades while Pan → Filter waits.
    h.apply(chain(width, tone));
    h.laneSends("a");
    expect(feeds(filter, panner)).toBe(true);
    expect(feeds(panner, filter)).toBe(false);

    await h.endFades();
    expect(feeds(filter, panner)).toBe(false);
    expect(feeds(panner, filter)).toBe(true);
  });

  test("a node that comes back as another kind is a new point", async () => {
    const h = createHarness();
    const through = (native: NodeInput) =>
      plan(
        [
          station("a"),
          station("b"),
          node("mix", "merge"),
          fx("comp", "compressor"),
          native,
          speakers,
        ],
        [
          audio("a", "mix"),
          audio("b", "mix"),
          audio("mix", "comp"),
          audio("comp", "x"),
          audio("x", "speakers"),
        ]
      );
    const asFilter = through(node("x", "filter", { frequency: 500 }));
    const asPan = through(node("x", "pan", { pan: -0.5 }));
    h.apply(asFilter);
    h.laneSends("a");
    await h.settle();
    const [filter] = h.context.filters as FakeFilterNode[];

    // Same id, now a Pan: the Filter goes and a panner takes its cables.
    h.apply(asPan);
    await h.endFades();

    const [panner] = h.context.panners;
    expect(lastValue(panner?.pan) ?? panner?.pan.value).toBe(-0.5);
    expect(filter?.connections.size).toBe(0);
    expect(feeds(h.attached.get("node-unit:mix")?.output, panner)).toBe(true);
    expect(h.sinks.get("speakers")?.size).toBe(1);
  });

  test("keys tap the cabled point, sum inputs and honor cable gain", async () => {
    const h = createHarness();
    const keyed = plan(
      [
        station("music"),
        station("talk"),
        station("news"),
        node("mix", "merge"),
        fx("comp", "compressor"),
        speakers,
      ],
      [
        audio("music", "comp"),
        audio("comp", "speakers"),
        audio("talk", "mix"),
        audio("news", "mix"),
        audio("mix", "speakers"),
        {
          gain: 0.5,
          id: "mix~>comp",
          source: "mix",
          sourceHandle: "out:audio:main",
          target: "comp",
          targetHandle: "in:sidechain:key",
        },
      ]
    );
    h.apply(keyed);
    h.laneSends("talk");
    h.laneSends("news");
    await h.settle();

    // The key hears the Merge's sum, at its cable's level, on its own input.
    const key = h.keys.get("comp:key") as FakeGainNode | undefined;
    expect(key).toBeDefined();
    const intoKey = h.context.gains.filter((gain) => gain.connections.has(key));
    expect(intoKey).toHaveLength(1);
    expect(lastValue(intoKey[0]?.gain)).toBe(0.5);

    // A key no cable needs any more goes once its cable has faded.
    h.apply(
      plan(
        [station("talk"), station("news"), node("mix", "merge"), speakers],
        [audio("talk", "mix"), audio("news", "mix"), audio("mix", "speakers")]
      )
    );
    await h.endFades();
    expect(h.keys.has("comp:key")).toBe(false);
  });

  test("the tap() API returns the summed input and changes with cables", async () => {
    const h = createHarness();
    const changes = mock(() => undefined);
    const stop = h.routing.onTapsChanged(changes);
    // A follower's tap, as the control layer plans it: a sum, handed on.
    const tapped: EnginePlan = {
      ...plan([station("a"), speakers], [audio("a", "speakers")]),
      modules: new Map([
        ["follow", { id: "follow", kind: "tap", realtime: false }],
      ]),
    };
    tapped.cables.set("a~>follow", {
      delay: 0,
      from: { id: "a", kind: "lane" },
      gain: 1,
      id: "a~>follow",
      kind: "audio",
      muted: false,
      reenters: false,
      to: { id: "follow", kind: "tap" },
    });
    h.apply(tapped);
    expect(h.routing.tap("follow")).toBeNull();

    const [send] = h.laneSends("a").values();
    const input = h.routing.tap("follow") as FakeGainNode | null;
    expect(input).not.toBeNull();
    expect(send?.gain.connections.has(input)).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);

    h.apply(plan([station("a"), speakers], [audio("a", "speakers")]));
    send?.release();
    await h.endFades();
    expect(h.routing.tap("follow")).toBeNull();
    expect(changes).toHaveBeenCalledTimes(2);
    stop();
  });

  test("a key is in, silent, before the FX keyed from it attach", async () => {
    const h = createHarness();
    const order: string[] = [];
    h.host.connectKey.mockImplementation((id: string) => {
      order.push(`key ${id}`);
    });
    h.host.attachEffects.mockImplementation((id: string) => {
      order.push(`attach ${id}`);
      return Promise.resolve(ready);
    });
    const keyed = (talk: boolean) =>
      plan(
        [
          station("music"),
          station("news"),
          station("talk"),
          node("mix", "merge"),
          fx("comp", "compressor"),
          speakers,
        ],
        [
          audio("music", "mix"),
          audio("news", "mix"),
          audio("mix", "comp"),
          audio("comp", "speakers"),
          audio("talk", "speakers"),
          ...(talk
            ? [
                {
                  id: "talk~>comp",
                  source: "talk",
                  sourceHandle: "out:audio:main",
                  target: "comp",
                  targetHandle: "in:sidechain:key",
                },
              ]
            : []),
        ]
      );
    h.apply(keyed(true));
    // Music plays; Talk, the key's only source, has not started yet.
    h.laneSends("music");
    await h.settle();

    expect(order).toEqual(["key comp:key", "attach node-unit:mix"]);
    // A key added while the graph plays is made at once, too.
    h.apply(keyed(false));
    await h.endFades();
    h.apply(keyed(true));
    expect(order.at(-1)).toBe("key comp:key");
  });
});
