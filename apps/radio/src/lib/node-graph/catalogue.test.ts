import { describe, expect, test } from "bun:test";
import { createDefaultEffectConfig } from "@/lib/audio/dsp/effects/registry";
import { EFFECT_DEFINITIONS } from "@/lib/audio/dsp/effects/schema";
import {
  createNodeEffectConfig,
  isShipped,
  NODE_DEFINITIONS,
  portHandleId,
  SIDECHAIN_EFFECT_TYPES,
} from "./catalogue";
import { MODULATION_NODE_TYPES } from "./modulation-schema";
import { NODE_TYPES, type NodeType, nodeGraphSchema } from "./schema";
import { validate } from "./validate";

const definitions = Object.values(NODE_DEFINITIONS);

describe("NODE_DEFINITIONS", () => {
  test("defines every node type under its own key", () => {
    expect(Object.keys(NODE_DEFINITIONS).sort()).toEqual(
      [...NODE_TYPES].sort()
    );
    for (const [type, definition] of Object.entries(NODE_DEFINITIONS)) {
      expect(definition.type).toBe(type as NodeType);
    }
  });

  test("ships 21 FX types in v1, all but Werkstatt", () => {
    const shippedFx = definitions.filter(
      (definition) => definition.effectType && definition.ship === "v1"
    );
    expect(shippedFx).toHaveLength(21);
    expect(shippedFx.map((definition) => definition.type)).not.toContain(
      "werkstatt"
    );
    expect(NODE_DEFINITIONS.werkstatt.ship).toBe("later");
  });

  test("each FX node resolves to createDefaultEffectConfig", () => {
    for (const definition of definitions) {
      const { effectType } = definition;
      if (!effectType) {
        continue;
      }
      expect(effectType).toBe(definition.type as typeof effectType);
      expect(createNodeEffectConfig(effectType, "node-1")).toEqual(
        createDefaultEffectConfig(effectType, "node-1", 0)
      );
    }
  });

  test("names FX after their effect definition, and containers as routing", () => {
    expect(NODE_DEFINITIONS.cheapReverb.name).toBe(
      EFFECT_DEFINITIONS.cheapReverb.name
    );
    expect(NODE_DEFINITIONS.plateReverb.name).toBe("Dattorro Reverb");
    expect(NODE_DEFINITIONS.fxComposite).toMatchObject({
      category: "routing",
      name: "Split",
    });
    expect(NODE_DEFINITIONS.stereoSplit.name).toBe("Stereo Split");
    expect(NODE_DEFINITIONS.frequencySplit.name).toBe("Band Split");
  });

  test("the v1 subset is Station, Track, File, Audio input, Speakers, Output device, the native strip, FX and in-lane Merge", () => {
    const v1 = definitions
      .filter(
        (definition) => definition.ship === "v1" && !definition.effectType
      )
      .map((definition) => definition.type)
      .sort();
    expect(v1).toEqual(
      [
        ...MODULATION_NODE_TYPES,
        "deviceIn",
        "deviceOut",
        "file",
        "filter",
        "gain",
        "merge",
        "pan",
        "platform",
        "speakers",
        "station",
      ].sort() as NodeType[]
    );
  });

  test("only compressor, gate and vocoder take a key", () => {
    const keyed = definitions
      .filter((definition) =>
        definition.ports.some((port) => port.kind === "sidechain")
      )
      .map((definition) => definition.type)
      .sort();
    expect(keyed).toEqual([...SIDECHAIN_EFFECT_TYPES].sort() as NodeType[]);
  });

  test("ports have unique handle ids and sane limits", () => {
    for (const definition of definitions) {
      const handles = definition.ports.map(portHandleId);
      expect(new Set(handles).size).toBe(handles.length);
      for (const port of definition.ports) {
        expect(port.max).toBeGreaterThanOrEqual(1);
        expect(port.label.length).toBeGreaterThan(0);
        if (port.kind === "sidechain") {
          expect(port.direction).toBe("in");
        }
      }
    }
    expect(NODE_DEFINITIONS.merge.ports[0]?.max).toBe(8);
  });

  test("describes Station control ports as landing with Control", () => {
    const later = NODE_DEFINITIONS.station.ports
      .filter((port) => port.ship === "v2")
      .map(portHandleId);
    expect(later).toEqual([
      "in:control:volume",
      "in:control:pan",
      "in:control:station",
      "out:control:songChange",
      "out:control:titleHash",
    ]);
  });
});

describe("non-v1 node types", () => {
  const unshipped = definitions.filter(
    (definition) => definition.ship !== "v1"
  );

  test("carry a non-v1 ship flag", () => {
    expect(unshipped.length).toBeGreaterThan(0);
    for (const definition of unshipped) {
      expect(["v2", "later"]).toContain(definition.ship);
    }
  });

  test.each(unshipped.map((definition) => [definition.type]))(
    "validate() rejects %s in v1",
    (type) => {
      const graph = nodeGraphSchema.parse({
        edges: [],
        nodes: [
          {
            data: NODE_DEFINITIONS[type].effectType
              ? {
                  effect: createNodeEffectConfig(
                    NODE_DEFINITIONS[type].effectType,
                    "node"
                  ),
                }
              : {},
            id: "node",
            position: { x: 0, y: 0 },
            type,
          },
          { id: "speakers", position: { x: 480, y: 0 }, type: "speakers" },
        ],
        version: 2,
      });
      expect(validate(graph)).toContainEqual(
        expect.objectContaining({
          code: "unshipped",
          id: "node",
          target: "node",
        })
      );
      expect(
        validate(graph, { release: "later" }).filter(
          (issue) => issue.code === "unshipped"
        )
      ).toEqual([]);
    }
  );
});

describe("catalogue invariants", () => {
  // The connection rules lean on these: a source makes its own sound, the
  // sound ends at an output, and every port takes at least one cable.
  test("a source takes no audio or key input", () => {
    const sources = definitions.filter((definition) => definition.source);
    expect(sources.length).toBeGreaterThan(0);
    for (const definition of sources) {
      expect(
        definition.ports
          .filter(
            (port) =>
              port.direction === "in" &&
              (port.kind === "audio" || port.kind === "sidechain")
          )
          .map(portHandleId)
      ).toEqual([]);
    }
  });

  test("Track and File are shipped stream sources drawing only their audio out", () => {
    for (const type of ["platform", "file"] as const) {
      const definition = NODE_DEFINITIONS[type];
      expect(definition).toMatchObject({
        category: "source",
        ship: "v1",
        source: true,
        stream: true,
      });
      expect(
        definition.ports
          .filter((port) => isShipped(port.ship ?? definition.ship, "v1"))
          .map(portHandleId)
      ).toEqual(["in:control:parameter", "out:audio:main"]);
    }
    expect(NODE_DEFINITIONS.platform.name).toBe("Track");
  });

  test("an output has no output port", () => {
    const outputs = definitions.filter(
      (definition) => definition.category === "output"
    );
    expect(outputs.map((definition) => definition.type)).toContain("speakers");
    for (const definition of outputs) {
      expect(
        definition.ports
          .filter((port) => port.direction === "out")
          .map(portHandleId)
      ).toEqual([]);
    }
  });

  test("every port takes at least one cable", () => {
    for (const definition of definitions) {
      for (const port of definition.ports) {
        expect(port.max).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
