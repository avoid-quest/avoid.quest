const WEBKIT_PATTERN = /AppleWebKit\//;
const OTHER_ENGINE_PATTERN = /(Chrome|Chromium|Edg|OPR|Android)\//;

export function isWebKitBrowser(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const { userAgent } = navigator;
  return (
    WEBKIT_PATTERN.test(userAgent) && !OTHER_ENGINE_PATTERN.test(userAgent)
  );
}
