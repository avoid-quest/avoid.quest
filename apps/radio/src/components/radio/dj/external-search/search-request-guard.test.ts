import { describe, expect, test } from "bun:test";
import { createSearchRequestGuard } from "./search-request-guard";

describe("search request guard", () => {
  test("invalidates in-flight results when the platform or filter context changes", () => {
    const guard = createSearchRequestGuard();
    guard.setContext("soundcloud:t:songs");
    const isOldRequestCurrent = guard.begin("soundcloud:t:songs");

    guard.setContext("bandcamp:a:songs");
    guard.setContext("soundcloud:t:songs");

    expect(isOldRequestCurrent()).toBeFalse();
  });

  test("only accepts the newest request in an unchanged context", () => {
    const guard = createSearchRequestGuard();
    guard.setContext("youtube:t:songs");
    const isFirstRequestCurrent = guard.begin("youtube:t:songs");
    const isSecondRequestCurrent = guard.begin("youtube:t:songs");

    expect(isFirstRequestCurrent()).toBeFalse();
    expect(isSecondRequestCurrent()).toBeTrue();
  });
});
