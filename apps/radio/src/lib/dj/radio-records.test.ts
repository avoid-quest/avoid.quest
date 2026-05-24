import { describe, expect, test } from "bun:test";
import type { RadioRecord } from "@/lib/collections";
import { radioRecordsToDjRadios } from "./radio-records";

const baseRadioRecord = {
  name: "Test Radio",
  streamUrl: "https://example.com/stream.mp3",
  order: 0,
  enabled: true,
  isSystem: false,
};

describe("radioRecordsToDjRadios", () => {
  test("preserves UUID string ids exactly", () => {
    const records: RadioRecord[] = [
      {
        ...baseRadioRecord,
        id: "018fc7a8-b98b-7000-9000-000000000001",
      },
    ];

    expect(radioRecordsToDjRadios(records)[0]?.id).toBe(
      "018fc7a8-b98b-7000-9000-000000000001"
    );
  });

  test("returns an empty list for missing records", () => {
    expect(radioRecordsToDjRadios(undefined)).toEqual([]);
  });
});
