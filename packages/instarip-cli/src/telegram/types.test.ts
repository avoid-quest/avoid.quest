import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SEND_LIMIT,
  MAX_CAPTION_LENGTH,
  MAX_MEDIA_GROUP_SIZE,
  MIN_MEDIA_GROUP_SIZE,
} from "./types";

describe("types", () => {
  test("constants have correct values", () => {
    const EXPECTED_MAX_MEDIA_GROUP_SIZE = 10;
    const EXPECTED_MIN_MEDIA_GROUP_SIZE = 2;
    const EXPECTED_MAX_CAPTION_LENGTH = 1024;
    const EXPECTED_DEFAULT_SEND_LIMIT = 3;
    expect(MAX_MEDIA_GROUP_SIZE).toBe(EXPECTED_MAX_MEDIA_GROUP_SIZE);
    expect(MIN_MEDIA_GROUP_SIZE).toBe(EXPECTED_MIN_MEDIA_GROUP_SIZE);
    expect(MAX_CAPTION_LENGTH).toBe(EXPECTED_MAX_CAPTION_LENGTH);
    expect(DEFAULT_SEND_LIMIT).toBe(EXPECTED_DEFAULT_SEND_LIMIT);
  });

  test("MAX_MEDIA_GROUP_SIZE is greater than MIN_MEDIA_GROUP_SIZE", () => {
    expect(MAX_MEDIA_GROUP_SIZE).toBeGreaterThan(MIN_MEDIA_GROUP_SIZE);
  });

  test("MAX_CAPTION_LENGTH is positive", () => {
    expect(MAX_CAPTION_LENGTH).toBeGreaterThan(0);
  });

  test("DEFAULT_SEND_LIMIT is positive", () => {
    expect(DEFAULT_SEND_LIMIT).toBeGreaterThan(0);
  });
});
