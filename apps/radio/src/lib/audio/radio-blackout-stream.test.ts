import { describe, expect, test } from "bun:test";
import { handleRadioBlackoutStreamRequest } from "./radio-blackout-stream";

describe("handleRadioBlackoutStreamRequest", () => {
  test("streams the fixed upstream while preserving media response headers", async () => {
    let upstreamRequest: Request | undefined;
    const response = await handleRadioBlackoutStreamRequest(
      new Request("https://radio.example/api/radio-blackout-stream", {
        headers: { Range: "bytes=0-1023" },
      }),
      async (input, init) => {
        upstreamRequest = new Request(input, init);
        return new Response("audio bytes", {
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Range": "bytes 0-10/11",
            "Content-Type": "audio/mpeg",
            "Icy-Name": "Radio BlackOut",
            "Set-Cookie": "do-not-forward=true",
          },
          status: 206,
        });
      }
    );

    expect(upstreamRequest?.url).toBe(
      "https://s.streampunk.cc/blackout.mp3"
    );
    expect(upstreamRequest?.method).toBe("GET");
    expect(upstreamRequest?.headers.get("Accept")).toBe("audio/mpeg");
    expect(upstreamRequest?.headers.get("Range")).toBe("bytes=0-1023");
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-10/11");
    expect(response.headers.get("Icy-Name")).toBe("Radio BlackOut");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await response.text()).toBe("audio bytes");
  });

  test("forwards HEAD without a response body", async () => {
    let method: string | undefined;
    const response = await handleRadioBlackoutStreamRequest(
      new Request("https://radio.example/api/radio-blackout-stream", {
        method: "HEAD",
      }),
      async (input, init) => {
        method = new Request(input, init).method;
        return new Response(null, {
          headers: { "Content-Type": "audio/mpeg" },
          status: 200,
        });
      }
    );

    expect(method).toBe("HEAD");
    expect(response.body).toBeNull();
  });
});
