import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import { radios as defaultRadios } from "@/lib/const";
import { getRadioMetadataConfig } from "./radio-config";
import { radioMetadataConfigSchema } from "./schema";

describe("radio metadata config fallback", () => {
  test("gives every default radio a valid metadata strategy", () => {
    const invalidRadios = defaultRadios.flatMap((radio) => {
      const result = radioMetadataConfigSchema.safeParse(radio.metadataConfig);

      return !result.success || result.data.kind === "none" ? [radio.name] : [];
    });

    expect(invalidRadios).toEqual([]);
  });

  test("uses working metadata strategies for default stations without status-json endpoints", () => {
    expect(
      Object.fromEntries(
        defaultRadios
          .filter((radio) =>
            [
              "Resonance Extra",
              "Internet Public Radio",
              "HKCR",
              "Lyl Radio",
              "Radio Alhara",
            ].includes(radio.name)
          )
          .map((radio) => [radio.name, radio.metadataConfig?.kind])
      )
    ).toEqual({
      HKCR: "hkcr-schedule",
      "Internet Public Radio": "airtime-live-info",
      "Lyl Radio": "lyl-api",
      "Radio Alhara": "radio-alhara-api",
      "Resonance Extra": "resonance-extra-api",
    });
  });

  test("does not seed permanently retired system stations", () => {
    expect(
      defaultRadios.some((radio) => radio.name === "Gatto Misterioso")
    ).toBe(false);
  });

  test("matches default metadata by stream URL after a station is renamed", () => {
    const defaultRadio = defaultRadios.find(
      (candidate) => candidate.metadataConfig
    );
    if (!defaultRadio) {
      throw new Error(
        "Expected at least one default radio with metadata config"
      );
    }

    const renamedRadio: Radio = {
      ...defaultRadio,
      metadataConfig: undefined,
      name: `${defaultRadio.name} renamed`,
    };

    expect(getRadioMetadataConfig(renamedRadio)).toEqual(
      defaultRadio.metadataConfig
    );
  });

  test("uses the current strategy for an unchanged system default", () => {
    const defaultRadio = defaultRadios.find(
      (candidate) => candidate.name === "Lyl Radio"
    );
    if (!defaultRadio) {
      throw new Error("Expected Lyl Radio in the default list");
    }

    const persistedRadio: Radio = {
      ...defaultRadio,
      metadataConfig: { kind: "icecast-status" },
    };

    expect(getRadioMetadataConfig(persistedRadio)).toEqual({ kind: "lyl-api" });
  });

  test("prefers explicit radio metadata config over the default fallback", () => {
    const defaultRadio = defaultRadios.find(
      (candidate) => candidate.metadataConfig
    );
    if (!defaultRadio) {
      throw new Error(
        "Expected at least one default radio with metadata config"
      );
    }

    const radio: Radio = {
      ...defaultRadio,
      isSystem: false,
      metadataConfig: { kind: "none" },
    };

    expect(getRadioMetadataConfig(radio)).toEqual({ kind: "none" });
  });
});
