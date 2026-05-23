import { describe, expect, test } from "bun:test";
import type { Radio } from "@/lib/audio";
import { radios as defaultRadios } from "@/lib/const";
import { getRadioMetadataConfig } from "./radio-config";

describe("radio metadata config fallback", () => {
  test("matches default metadata by stream URL after a station is renamed", () => {
    const defaultRadio = defaultRadios.find((radio) => radio.metadataConfig);
    if (!defaultRadio) {
      throw new Error(
        "Expected at least one default radio with metadata config"
      );
    }

    const renamedRadio: Radio = {
      ...defaultRadio,
      name: `${defaultRadio.name} renamed`,
      metadataConfig: undefined,
    };

    expect(getRadioMetadataConfig(renamedRadio)).toEqual(
      defaultRadio.metadataConfig
    );
  });

  test("prefers explicit radio metadata config over the default fallback", () => {
    const defaultRadio = defaultRadios.find((radio) => radio.metadataConfig);
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
