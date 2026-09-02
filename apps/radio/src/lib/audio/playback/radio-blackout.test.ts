import { describe, expect, test } from "bun:test";
import {
  isRadioBlackoutStreamUrl,
  RADIO_BLACKOUT_STREAM_URL,
} from "./radio-blackout";

describe("Radio BlackOut stream policy", () => {
  test("recognizes current and persisted stream URLs", () => {
    for (const url of [
      "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
      RADIO_BLACKOUT_STREAM_URL,
      "https://seep.eu.org/https://s.streampunk.cc/blackout.mp3",
      "https://proxy.cors.sh/https://s.streampunk.cc/blackout.mp3",
    ]) {
      expect(isRadioBlackoutStreamUrl(url)).toBe(true);
    }
  });

  test("rejects lookalike URLs", () => {
    expect(
      isRadioBlackoutStreamUrl(
        "https://example.com/https://s.streampunk.cc/blackout.mp3"
      )
    ).toBe(false);
  });
});
