import { describe, expect, test } from "bun:test";
import { sanitizeForBluetooth } from "./use-media-session";

describe("sanitizeForBluetooth", () => {
  test("strips Arabic characters", () => {
    const input = "Radio AlHara راديو الحارة";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Radio AlHara");
  });

  test("strips emoji", () => {
    const input = "Radio 🎙️ Station 📻";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Radio Station");
  });

  test("handles empty string", () => {
    const result = sanitizeForBluetooth("");
    expect(result).toBe("Radio");
  });

  test("handles whitespace-only string", () => {
    const result = sanitizeForBluetooth("   ");
    expect(result).toBe("Radio");
  });

  test("preserves already-clean string", () => {
    const input = "Classic FM";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Classic FM");
  });

  test("collapses multiple spaces", () => {
    const input = "Radio   Station   Name";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Radio Station Name");
  });

  test("preserves ASCII punctuation and numbers", () => {
    const input = "Radio 101.5 FM - Live";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("Radio 101.5 FM - Live");
  });

  test("handles mixed scripts with spaces", () => {
    const input = "BBC Radio  ثى رادیو";
    const result = sanitizeForBluetooth(input);
    expect(result).toBe("BBC Radio");
  });

  test("keeps accented letters as their base letter", () => {
    expect(sanitizeForBluetooth("Cliché Toupée")).toBe("Cliche Toupee");
    expect(sanitizeForBluetooth("Se Desbordó el Jardín")).toBe(
      "Se Desbordo el Jardin"
    );
  });

  test("maps typographic punctuation to ASCII", () => {
    expect(sanitizeForBluetooth("GUESTS 113 – Nice Strangers")).toBe(
      "GUESTS 113 - Nice Strangers"
    );
    expect(sanitizeForBluetooth("Summer’s “Last” Sound…")).toBe(
      `Summer's "Last" Sound...`
    );
  });
});
