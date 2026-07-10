const COMPATIBILITY_FALLBACK_STORAGE_KEY =
  "radio-app-allow-compatibility-fallbacks";

function browserStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function getCompatibilityFallbacksEnabled(
  storage: Storage | null = browserStorage()
): boolean {
  return storage?.getItem(COMPATIBILITY_FALLBACK_STORAGE_KEY) !== "false";
}

export function setCompatibilityFallbacksEnabled(
  enabled: boolean,
  storage: Storage | null = browserStorage()
): boolean {
  storage?.setItem(COMPATIBILITY_FALLBACK_STORAGE_KEY, String(enabled));
  return enabled;
}

export function resetCompatibilityFallbacks(
  storage: Storage | null = browserStorage()
): void {
  storage?.removeItem(COMPATIBILITY_FALLBACK_STORAGE_KEY);
}

export { COMPATIBILITY_FALLBACK_STORAGE_KEY };
