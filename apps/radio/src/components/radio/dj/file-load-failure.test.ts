import { describe, expect, test } from "bun:test";
import { describeFileLoadFailure } from "./file-load-failure";

describe("describeFileLoadFailure", () => {
  test("says a remote file's link could not be reached in plain words", () => {
    expect(describeFileLoadFailure("Failed to fetch")).toBe(
      "Couldn't load that file: the link couldn't be reached"
    );
  });

  test("keeps a specific reason", () => {
    expect(describeFileLoadFailure("Unsupported audio format.")).toBe(
      "Couldn't load that file: Unsupported audio format"
    );
  });
});
