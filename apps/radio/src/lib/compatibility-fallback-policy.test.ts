import { describe, expect, test } from "bun:test";
import {
  COMPATIBILITY_FALLBACK_STORAGE_KEY,
  getCompatibilityFallbacksEnabled,
  resetCompatibilityFallbacks,
  setCompatibilityFallbacksEnabled,
} from "./compatibility-fallback-policy";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("compatibility fallback policy", () => {
  test("defaults on and persists the user's explicit choice", () => {
    const storage = new MemoryStorage();

    expect(getCompatibilityFallbacksEnabled(storage)).toBeTrue();
    expect(setCompatibilityFallbacksEnabled(false, storage)).toBeFalse();
    expect(storage.getItem(COMPATIBILITY_FALLBACK_STORAGE_KEY)).toBe("false");
    expect(getCompatibilityFallbacksEnabled(storage)).toBeFalse();
    expect(setCompatibilityFallbacksEnabled(true, storage)).toBeTrue();
    expect(getCompatibilityFallbacksEnabled(storage)).toBeTrue();
  });

  test("treats unknown stored values as enabled for backward compatibility", () => {
    const storage = new MemoryStorage();
    storage.setItem(COMPATIBILITY_FALLBACK_STORAGE_KEY, "invalid");

    expect(getCompatibilityFallbacksEnabled(storage)).toBeTrue();
  });

  test("reset removes an explicit opt-out and restores the default", () => {
    const storage = new MemoryStorage();
    setCompatibilityFallbacksEnabled(false, storage);

    resetCompatibilityFallbacks(storage);

    expect(storage.getItem(COMPATIBILITY_FALLBACK_STORAGE_KEY)).toBeNull();
    expect(getCompatibilityFallbacksEnabled(storage)).toBeTrue();
  });
});
