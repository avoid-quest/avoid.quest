import { NextResponse } from "next/server";

export const runtime = "nodejs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
};

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: "URL parameter is required" },
      { status: 400 }
    );
  }

  // Validate that it's a SoundCloud stream URL
  // SoundCloud stream URLs typically come from transcodings and may be from various CDN domains
  // We'll validate by checking if it's a valid URL and not a SoundCloud page URL
  try {
    const urlObj = new URL(url);

    // If it's a SoundCloud page URL, reject it (should be a stream URL)
    if (
      urlObj.hostname === "soundcloud.com" ||
      urlObj.hostname === "www.soundcloud.com"
    ) {
      return NextResponse.json(
        { error: "Invalid URL: must be a stream URL, not a page URL" },
        { status: 400 }
      );
    }

    // Allow any valid URL - SoundCloud may use various CDN domains
  } catch {
    return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
  }

  const res = await fetch(url, {
    headers: {
      Range: request.headers.get("range") || "",
      Referer: "https://soundcloud.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `Failed to fetch stream: ${res.statusText}` },
      { status: res.status }
    );
  }

  const headers: HeadersInit = {
    ...cors,
    "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
    "Accept-Ranges": "bytes",
  };
  const length = res.headers.get("Content-Length");
  const range = res.headers.get("Content-Range");
  if (length) {
    headers["Content-Length"] = length;
  }
  if (range) {
    headers["Content-Range"] = range;
  }

  return new NextResponse(res.body, { status: res.status, headers });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors });
}
