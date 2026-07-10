import { describe, expect, test } from "bun:test";
import {
  addRelayService,
  clearRelayConfiguration,
  getRelayConfiguration,
  getStreamRelayUrls,
  RELAY_STORAGE_KEY,
  RelayConfigurationError,
  removeRelayService,
  reorderRelayServices,
  saveRelayConfiguration,
  setRelayServiceEnabled,
} from "./relay-configuration";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function manifest(capabilities: string[], name = "Test relay"): Response {
  return Response.json({ capabilities, name, version: 1 });
}

describe("relay configuration", () => {
  test("defaults safely when storage is empty or malformed", () => {
    const storage = new MemoryStorage();

    expect(getRelayConfiguration(storage)).toEqual({
      services: [],
      version: 1,
    });

    storage.setItem(RELAY_STORAGE_KEY, "not-json");
    expect(getRelayConfiguration(storage)).toEqual({
      services: [],
      version: 1,
    });
  });

  test("handshakes multiple services and persists normalized capabilities", async () => {
    const storage = new MemoryStorage();
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const fetchImpl = ((input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ init, url: String(input) });
      return Promise.resolve(
        requests.length === 1
          ? manifest(["stream", "hls", "stream"], "Primary")
          : manifest(["hls"], "HLS only")
      );
    }) as typeof fetch;

    const saved = await saveRelayConfiguration(
      [
        { baseUrl: "https://relay-one.example/edge/" },
        { baseUrl: "http://localhost:8787", enabled: false },
      ],
      { fetchImpl, storage }
    );

    expect(requests.map(({ url }) => url)).toEqual([
      "https://relay-one.example/edge/.well-known/avoid-radio-relay.json",
      "http://localhost:8787/.well-known/avoid-radio-relay.json",
    ]);
    for (const { init } of requests) {
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
      expect(init?.referrerPolicy).toBe("no-referrer");
    }
    expect(saved.services).toEqual([
      {
        baseUrl: "https://relay-one.example/edge",
        capabilities: ["stream", "hls"],
        enabled: true,
        kind: "stream-relay",
        name: "Primary",
      },
      {
        baseUrl: "http://localhost:8787",
        capabilities: ["hls"],
        enabled: false,
        kind: "stream-relay",
        name: "HLS only",
      },
    ]);
    expect(getRelayConfiguration(storage)).toEqual(saved);
  });

  test("builds safely encoded URLs for enabled stream relays only", () => {
    const upstream = "https://radio.example/live.mp3?token=a b&quality=hi";

    expect(
      getStreamRelayUrls(upstream, "progressive", {
        services: [
          {
            baseUrl: "https://one.example",
            capabilities: ["stream"],
            enabled: true,
            kind: "stream-relay",
            name: "One",
          },
          {
            baseUrl: "https://two.example/relay",
            capabilities: ["hls"],
            enabled: true,
            kind: "stream-relay",
            name: "HLS",
          },
          {
            baseUrl: "https://three.example",
            capabilities: ["stream"],
            enabled: false,
            kind: "stream-relay",
            name: "Three",
          },
        ],
        version: 1,
      })
    ).toEqual([
      `https://one.example/api/stream-proxy?${new URLSearchParams({ url: upstream })}`,
    ]);
  });

  test("rejects insecure non-local relays before the handshake", async () => {
    let fetchCalled = false;

    await expect(
      saveRelayConfiguration([{ baseUrl: "http://relay.example" }], {
        fetchImpl: (() => {
          fetchCalled = true;
          return Promise.resolve(manifest(["stream"]));
        }) as unknown as typeof fetch,
        storage: new MemoryStorage(),
      })
    ).rejects.toBeInstanceOf(RelayConfigurationError);
    expect(fetchCalled).toBe(false);
  });

  test("rejects malformed or oversized handshake capabilities", async () => {
    const storage = new MemoryStorage();
    const oversized = Array.from({ length: 33 }, () => "stream");

    await expect(
      saveRelayConfiguration([{ baseUrl: "https://relay.example" }], {
        fetchImpl: (() =>
          Promise.resolve(manifest(oversized))) as unknown as typeof fetch,
        storage,
      })
    ).rejects.toBeInstanceOf(RelayConfigurationError);
    expect(storage.getItem(RELAY_STORAGE_KEY)).toBeNull();
  });

  test("aborts a handshake when its timeout expires", async () => {
    const fetchImpl = ((_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          {
            once: true,
          }
        );
      })) as typeof fetch;

    await expect(
      saveRelayConfiguration([{ baseUrl: "https://slow.example" }], {
        fetchImpl,
        storage: new MemoryStorage(),
        timeoutMs: 5,
      })
    ).rejects.toThrow("Relay handshake was aborted");
  });

  test("toggles and removes an already validated relay without another handshake", async () => {
    const storage = new MemoryStorage();
    await saveRelayConfiguration([{ baseUrl: "https://relay.example" }], {
      fetchImpl: (() =>
        Promise.resolve(manifest(["stream"]))) as unknown as typeof fetch,
      storage,
    });

    expect(
      setRelayServiceEnabled("https://relay.example/", false, storage)
        .services[0]?.enabled
    ).toBe(false);
    expect(
      removeRelayService("https://relay.example", storage).services
    ).toEqual([]);
  });

  test("reorders validated relays without another handshake", async () => {
    const storage = new MemoryStorage();
    await saveRelayConfiguration(
      [{ baseUrl: "https://one.example" }, { baseUrl: "https://two.example" }],
      {
        fetchImpl: (() =>
          Promise.resolve(manifest(["stream"]))) as unknown as typeof fetch,
        storage,
      }
    );

    expect(
      reorderRelayServices(
        ["https://two.example", "https://one.example"],
        storage
      ).services.map(({ baseUrl }) => baseUrl)
    ).toEqual(["https://two.example", "https://one.example"]);
    expect(() =>
      reorderRelayServices(["https://one.example"], storage)
    ).toThrow("include every configured service once");
  });

  test("adds one validated service without rechecking existing services", async () => {
    const storage = new MemoryStorage();
    await saveRelayConfiguration([{ baseUrl: "https://existing.example" }], {
      fetchImpl: (() =>
        Promise.resolve(manifest(["stream"]))) as unknown as typeof fetch,
      storage,
    });

    const configuration = await addRelayService(
      { baseUrl: "https://new.example" },
      {
        fetchImpl: (() =>
          Promise.resolve(manifest(["hls"], "New"))) as unknown as typeof fetch,
        storage,
      }
    );

    expect(configuration.services.map(({ name }) => name)).toEqual([
      "Test relay",
      "New",
    ]);
    clearRelayConfiguration(storage);
    expect(getRelayConfiguration(storage).services).toEqual([]);
  });

  test("merges a verified add into the latest stored order and state", async () => {
    const storage = new MemoryStorage();
    await saveRelayConfiguration(
      [{ baseUrl: "https://one.example" }, { baseUrl: "https://two.example" }],
      {
        fetchImpl: (() =>
          Promise.resolve(manifest(["stream"]))) as unknown as typeof fetch,
        storage,
      }
    );

    let finishHandshake: ((response: Response) => void) | undefined;
    const pending = addRelayService(
      { baseUrl: "https://pending.example" },
      {
        fetchImpl: (() =>
          new Promise<Response>((resolve) => {
            finishHandshake = resolve;
          })) as unknown as typeof fetch,
        storage,
      }
    );
    setRelayServiceEnabled("https://one.example", false, storage);
    reorderRelayServices(
      ["https://two.example", "https://one.example"],
      storage
    );
    removeRelayService("https://two.example", storage);
    finishHandshake?.(manifest(["hls"], "Pending"));

    const configuration = await pending;
    expect(
      configuration.services.map(({ baseUrl, enabled }) => ({
        baseUrl,
        enabled,
      }))
    ).toEqual([
      { baseUrl: "https://one.example", enabled: false },
      { baseUrl: "https://pending.example", enabled: true },
    ]);
  });
});
