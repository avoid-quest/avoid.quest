import { describe, expect, test } from "bun:test";
import { EffectSource } from "../processor-source";
import { ContainerEffect } from "./container-effects";
import { createDefaultEffectConfig } from "./registry";
import { clampEffectTempo, MAX_EFFECT_TEMPO, MIN_EFFECT_TEMPO } from "./tempo";
import { TidalEffect } from "./tidal";

const readTempo = (value: unknown): number =>
  (value as { tempo: number }).tempo;

describe("effect tempo range", () => {
  test("uses 30–1000 BPM across compatibility runtimes", () => {
    expect(clampEffectTempo(-1)).toBe(MIN_EFFECT_TEMPO);
    expect(clampEffectTempo(750)).toBe(750);
    expect(clampEffectTempo(2000)).toBe(MAX_EFFECT_TEMPO);

    const source = new EffectSource("source", 48_000);
    source.setTempo(1000);
    expect(readTempo(source)).toBe(1000);

    const tidal = new TidalEffect(48_000);
    tidal.setTempo(1000);
    expect(readTempo(tidal)).toBe(1000);

    const container = new ContainerEffect(
      "fxComposite",
      48_000,
      createDefaultEffectConfig("fxComposite", "container", 0),
      () => null
    );
    container.setTempo(1000);
    expect(readTempo(container)).toBe(1000);
  });
});
