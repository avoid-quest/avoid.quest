import { NextResponse } from "next/server";

export const runtime = "nodejs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
};

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url?.includes("bcbits.com")) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const res = await fetch(url, {
    headers: {
      Range: request.headers.get("range") || "",
      Referer: "https://bandcamp.com/",
    },
  });

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
