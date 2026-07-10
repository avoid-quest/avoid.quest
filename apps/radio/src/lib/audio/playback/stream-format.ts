export type StreamFormat = "hls" | "progressive";

export function inferStreamFormat(url: string, depth = 0): StreamFormat {
  try {
    const base =
      typeof location === "undefined"
        ? "https://playback.invalid"
        : location.origin;
    const parsed = new URL(url, base);
    if (parsed.pathname.toLowerCase().endsWith(".m3u8")) {
      return "hls";
    }

    const nestedUrl = depth === 0 ? parsed.searchParams.get("url") : null;
    return nestedUrl ? inferStreamFormat(nestedUrl, depth + 1) : "progressive";
  } catch {
    return "progressive";
  }
}
