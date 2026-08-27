import { describe, expect, mock, test } from "bun:test";
import {
  DirectAudioFetchError,
  DirectAudioHeaderTimeoutError,
  fetchDirectAudioStream,
} from "./direct-audio";

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  let output = "";
  for await (const chunk of stream) {
    output += Buffer.from(chunk as Uint8Array).toString("utf8");
  }
  return output;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("fetchDirectAudioStream", () => {
  test("rejects direct private, localhost, link-local, and metadata URLs before fetching", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("Unsafe direct audio URLs should not be fetched");
    });

    const unsafeUrls = [
      "http://127.0.0.1/live.mp3",
      "http://localhost/live.mp3",
      "http://169.254.169.254/latest/meta-data.mp3",
      "http://metadata.google.internal/live.mp3",
      "http://[fe80::1]/live.mp3",
    ];
    await Promise.all(
      unsafeUrls.map(async (url) => {
        await expect(
          fetchDirectAudioStream(url, { fetchImpl })
        ).rejects.toMatchObject({
          reason: "internal-address",
          url,
        });
      })
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects hostnames that resolve to private addresses before fetching", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("Private resolved addresses should not be fetched");
    });

    await expect(
      fetchDirectAudioStream("https://audio.example/live.mp3", {
        fetchImpl,
        resolveHostname: async () => ["10.0.0.12"],
      })
    ).rejects.toMatchObject({
      reason: "internal-address",
      url: "https://audio.example/live.mp3",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects socket lookups that rebind to private addresses", async () => {
    const url = "http://audio.example/live.mp3";

    await expect(
      fetchDirectAudioStream(url, {
        resolveHostname: async () => ["93.184.216.34"],
        resolveSocketAddresses: async () => [
          { address: "127.0.0.1", family: 4 },
        ],
      })
    ).rejects.toMatchObject({
      reason: "internal-address",
      url,
    });
  });

  test("rejects redirects to internal addresses before fetching the target", async () => {
    const requestedUrls: string[] = [];
    const initialUrl = "https://audio.example/live.mp3";
    const fetchImpl = mock(async (url: string) => {
      await Promise.resolve();
      requestedUrls.push(url);
      return Response.redirect("http://127.0.0.1/live.mp3", 302);
    });

    await expect(
      fetchDirectAudioStream(initialUrl, {
        fetchImpl,
        resolveHostname: async () => ["93.184.216.34"],
      })
    ).rejects.toBeInstanceOf(DirectAudioFetchError);
    expect(requestedUrls).toEqual([initialUrl]);
  });

  test("streams allowed public URLs after validated redirect resolution", async () => {
    const requestedUrls: string[] = [];
    const forwardedUserAgents: Array<string | null> = [];
    const initialUrl = "https://audio.example/live.mp3";
    const finalUrl = "https://cdn.example/live.mp3";
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      requestedUrls.push(url);
      forwardedUserAgents.push(new Headers(init?.headers).get("User-Agent"));

      if (url === initialUrl) {
        return Response.redirect(finalUrl, 302);
      }

      return new Response("audio-bytes");
    });

    const result = await fetchDirectAudioStream(initialUrl, {
      fetchImpl,
      resolveHostname: async () => ["93.184.216.34"],
    });

    expect(result.resolvedUrl).toBe(finalUrl);
    await expect(readStream(result.stream)).resolves.toBe("audio-bytes");
    expect(requestedUrls).toEqual([initialUrl, finalUrl]);
    expect(forwardedUserAgents).toEqual([
      "avoid.quest-discord-bot/1.0",
      "avoid.quest-discord-bot/1.0",
    ]);
  });

  test("times out direct audio fetches before response headers arrive", async () => {
    const initialUrl = "https://audio.example/live.mp3";
    const fetchImpl = mock(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("Missing abort signal"));
            return;
          }

          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        })
    );

    await expect(
      fetchDirectAudioStream(initialUrl, {
        fetchImpl,
        headerFetchTimeoutMs: 1,
        resolveHostname: async () => ["93.184.216.34"],
      })
    ).rejects.toBeInstanceOf(DirectAudioHeaderTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("clears the header timeout after response headers arrive", async () => {
    let headerSignal: AbortSignal | undefined;
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      await Promise.resolve();
      headerSignal = init?.signal ?? undefined;
      return new Response("audio-bytes");
    });

    const result = await fetchDirectAudioStream(
      "https://audio.example/live.mp3",
      {
        fetchImpl,
        headerFetchTimeoutMs: 1,
        resolveHostname: async () => ["93.184.216.34"],
      }
    );

    await delay(5);
    expect(headerSignal?.aborted).toBe(false);
    await expect(readStream(result.stream)).resolves.toBe("audio-bytes");
  });
});
