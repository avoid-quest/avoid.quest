type StorageArea = "localStorage" | "sessionStorage";

/**
 * `scope`'s storage `area`, or undefined when it has none. Browsers that
 * block site data throw a SecurityError on this read; that counts as none,
 * so callers keep their values in memory or skip saving them.
 */
export function getBrowserStorage(
  area: StorageArea,
  scope: Partial<Record<StorageArea, Storage>> = globalThis
): Storage | undefined {
  try {
    return scope[area];
  } catch {
    return undefined;
  }
}
