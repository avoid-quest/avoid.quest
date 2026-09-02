import { describe, expect, test } from "bun:test";
import { handleRadioBlackoutStreamRequest } from "./radio-blackout-stream";

describe("handleRadioBlackoutStreamRequest", () => {
  test("races only the fixed HTTP Icecast mounts and streams the first success", async () => {
    const requests: Request[] = [];
    const response = await handleRadioBlackoutStreamRequest(
      new Request("https://radio.example/api/radio-blackout-stream"),
      async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url === "http://s.streampunk.cc/blackout.ogg") {
          throw new Error("primary unavailable");
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "audio/ogg" },
        });
      }
    );

    expect(requests.map((request) => request.url).sort()).toEqual([
      "http://s.streampunk.cc/blackout.ogg",
      "http://stream.radioblackout.org/blackout.ogg",
    ]);
    for (const request of requests) {
      expect(request.headers.get("Accept")).toContain("audio/ogg");
      expect(request.headers.get("Icy-MetaData")).toBe("0");
    }
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/ogg");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      1, 2, 3,
    ]);
  });

  test("answers HEAD without opening an upstream connection", async () => {
    let fetched = false;
    const response = await handleRadioBlackoutStreamRequest(
      new Request("https://radio.example/api/radio-blackout-stream", {
        method: "HEAD",
      }),
      async () => {
        fetched = true;
        return new Response(null);
      }
    );

    expect(fetched).toBe(false);
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("audio/ogg");
  });
});
