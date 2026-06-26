import { describe, expect, mock, test } from "bun:test";
import { DirectAudioFetchError, fetchDirectAudioStream } from "./direct-audio";

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  let output = "";
  for await (const chunk of stream) {
    output += Buffer.from(chunk as Uint8Array).toString("utf8");
  }
  return output;
}

describe("fetchDirectAudioStream", () => {
  test("rejects direct private, localhost, link-local, and metadata URLs before fetching", async () => {
    const fetchImpl = mock(async () => {
      await Promise.resolve();
      throw new Error("Unsafe direct audio URLs should not be fetched");
    });

    for (const url of [
      "http://127.0.0.1/live.mp3",
      "http://localhost/live.mp3",
      "http://169.254.169.254/latest/meta-data.mp3",
      "http://metadata.google.internal/live.mp3",
      "http://[fe80::1]/live.mp3",
    ]) {
      await expect(
        fetchDirectAudioStream(url, { fetchImpl })
      ).rejects.toMatchObject({
        reason: "internal-address",
        url,
      });
    }

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
});
