import { describe, test, expect } from "bun:test";
import {
  MAX_MEDIA_GROUP_SIZE,
  MIN_MEDIA_GROUP_SIZE,
  MAX_CAPTION_LENGTH,
  DEFAULT_SEND_LIMIT,
} from "./types";

describe("types", () => {
  test("constants have correct values", () => {
    expect(MAX_MEDIA_GROUP_SIZE).toBe(10);
    expect(MIN_MEDIA_GROUP_SIZE).toBe(2);
    expect(MAX_CAPTION_LENGTH).toBe(1024);
    expect(DEFAULT_SEND_LIMIT).toBe(3);
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

