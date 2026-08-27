import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import { radios as defaultRadios } from "@/lib/const";
import { getRadioMetadataConfig } from "./radio-config";

describe("radio metadata config fallback", () => {
  test("uses working metadata strategies for default stations without status-json endpoints", () => {
    expect(
      Object.fromEntries(
        defaultRadios
          .filter((radio) =>
            [
              "Resonance Extra",
              "Internet Public Radio",
              "Radio Alhara",
            ].includes(radio.name)
          )
          .map((radio) => [radio.name, radio.metadataConfig?.kind])
      )
    ).toEqual({
      "Internet Public Radio": "airtime-live-info",
      "Radio Alhara": "icy",
      "Resonance Extra": "icy",
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
      metadataConfig: { kind: "none" },
    };

    expect(getRadioMetadataConfig(radio)).toEqual({ kind: "none" });
  });
});
