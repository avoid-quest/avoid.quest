import { describe, expect, test } from "bun:test";
import type {
  ResolverCapability,
  ResolverManifest,
} from "@avoid.quest/platforms/resolver";
import {
  addResolverService,
  clearResolverConfiguration,
  getResolverConfiguration,
  MAX_RESOLVER_SERVICES,
  RESOLVER_STORAGE_KEY,
  type ResolverConfiguration,
  ResolverConfigurationError,
  removeResolverService,
  reorderResolverServices,
  setResolverServiceEnabled,
} from "./resolver-configuration";

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

function manifest(
  capabilities: readonly ResolverCapability[] = [
    "bandcamp:search",
    "bandcamp:resolve",
  ],
  name = "Test resolver"
): ResolverManifest {
  return {
    capabilities,
    name,
    protocol: "avoid-radio-resolver",
    version: 1,
  };
}

describe("resolver configuration", () => {
  test("defaults safely when dedicated storage is empty or malformed", () => {
    const storage = new MemoryStorage();
    const empty: ResolverConfiguration = { services: [], version: 1 };

    expect(getResolverConfiguration(storage)).toEqual(empty);
    storage.setItem(RESOLVER_STORAGE_KEY, "not-json");
    expect(getResolverConfiguration(storage)).toEqual(empty);
    storage.setItem(
      RESOLVER_STORAGE_KEY,
      JSON.stringify({
        services: [
          {
            baseUrl: "https://resolver.example",
            capabilities: ["unknown:search"],
            enabled: true,
            kind: "platform-resolver",
            name: "Invalid",
          },
        ],
        version: 1,
      })
    );
    expect(getResolverConfiguration(storage)).toEqual(empty);
  });

  test("verifies before persisting a normalized service and its capabilities", async () => {
    const storage = new MemoryStorage();
    const signal = new AbortController().signal;
    const calls: Array<{ baseUrl: string; signal?: AbortSignal }> = [];

    const configuration = await addResolverService(
      { baseUrl: "https://resolver.example/api///" },
      {
        signal,
        storage,
        verify: (baseUrl, receivedSignal) => {
          calls.push({ baseUrl, signal: receivedSignal });
          return Promise.resolve(
            manifest(
              ["soundcloud:search", "soundcloud:resolve", "soundcloud:search"],
              "  Browser resolver  "
            )
          );
        },
      }
    );

    expect(calls).toEqual([
      { baseUrl: "https://resolver.example/api", signal },
    ]);
    expect(configuration.services).toEqual([
      {
        baseUrl: "https://resolver.example/api",
        capabilities: ["soundcloud:search", "soundcloud:resolve"],
        enabled: true,
        kind: "platform-resolver",
        name: "Browser resolver",
      },
    ]);
    expect(getResolverConfiguration(storage)).toEqual(configuration);
  });

  test("uses the HTTP resolver adapter for the default manifest handshake", async () => {
    const storage = new MemoryStorage();
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const fetchImpl = ((input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ init, url: String(input) });
      return Promise.resolve(Response.json(manifest()));
    }) as typeof fetch;

    await addResolverService(
      { baseUrl: "https://resolver.example/edge" },
      { fetchImpl, storage }
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://resolver.example/edge/.well-known/avoid-radio-resolver.json"
    );
    expect(requests[0]?.init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  test("rejects unsafe and same-origin URLs before verification", async () => {
    const storage = new MemoryStorage();
    let verificationCalls = 0;
    const verify = () => {
      verificationCalls += 1;
      return Promise.resolve(manifest());
    };
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { origin: "https://app.example" },
    });

    try {
      for (const baseUrl of [
        "http://resolver.example",
        "https://user:secret@resolver.example",
        "https://resolver.example?token=secret",
        "https://resolver.example#fragment",
        "https://app.example/resolver",
      ]) {
        await expect(
          addResolverService({ baseUrl }, { storage, verify })
        ).rejects.toBeInstanceOf(ResolverConfigurationError);
      }
    } finally {
      if (originalLocation) {
        Object.defineProperty(globalThis, "location", {
          configurable: true,
          value: originalLocation,
        });
      } else {
        Object.defineProperty(globalThis, "location", {
          configurable: true,
          value: undefined,
        });
      }
    }

    expect(verificationCalls).toBe(0);
    expect(storage.getItem(RESOLVER_STORAGE_KEY)).toBeNull();
  });

  test("does not persist failed or malformed verification", async () => {
    const storage = new MemoryStorage();

    await expect(
      addResolverService(
        { baseUrl: "https://broken.example" },
        {
          storage,
          verify: () => Promise.reject(new Error("offline")),
        }
      )
    ).rejects.toThrow("Resolver verification failed");
    await expect(
      addResolverService(
        { baseUrl: "https://malformed.example" },
        {
          storage,
          verify: () =>
            Promise.resolve({
              ...manifest(),
              capabilities: ["unsupported:resolve"],
            } as unknown as ResolverManifest),
        }
      )
    ).rejects.toThrow("Resolver capability is invalid");
    expect(storage.getItem(RESOLVER_STORAGE_KEY)).toBeNull();
  });

  test("enforces unique services and the eight-service limit before verification", async () => {
    const storage = new MemoryStorage();
    let verificationCalls = 0;
    const verify = () => {
      verificationCalls += 1;
      return Promise.resolve(manifest());
    };

    await addResolverService(
      { baseUrl: "https://resolver-0.example" },
      { storage, verify }
    );
    await expect(
      addResolverService(
        { baseUrl: "https://resolver-0.example/" },
        { storage, verify }
      )
    ).rejects.toThrow("already configured");
    for (let index = 1; index < MAX_RESOLVER_SERVICES; index += 1) {
      await addResolverService(
        { baseUrl: `https://resolver-${index}.example` },
        { storage, verify }
      );
    }
    await expect(
      addResolverService(
        { baseUrl: "https://resolver-overflow.example" },
        { storage, verify }
      )
    ).rejects.toThrow(`At most ${MAX_RESOLVER_SERVICES}`);

    expect(verificationCalls).toBe(MAX_RESOLVER_SERVICES);
  });

  test("toggles, reorders, removes, and clears without another verification", async () => {
    const storage = new MemoryStorage();
    storage.setItem("unrelated", "keep");
    const verify = (baseUrl: string) =>
      Promise.resolve(
        manifest(
          baseUrl.includes("one")
            ? ["radiogarden:search"]
            : ["radiogarden:resolve"]
        )
      );

    await addResolverService(
      { baseUrl: "https://one.example" },
      { storage, verify }
    );
    await addResolverService(
      { baseUrl: "https://two.example" },
      { storage, verify }
    );

    expect(
      setResolverServiceEnabled("https://one.example/", false, storage)
        .services[0]?.enabled
    ).toBe(false);
    expect(
      reorderResolverServices(
        ["https://two.example", "https://one.example"],
        storage
      ).services.map(({ baseUrl }) => baseUrl)
    ).toEqual(["https://two.example", "https://one.example"]);
    expect(() =>
      reorderResolverServices(["https://one.example"], storage)
    ).toThrow("include every configured service once");
    expect(
      removeResolverService("https://two.example", storage).services.map(
        ({ baseUrl }) => baseUrl
      )
    ).toEqual(["https://one.example"]);

    clearResolverConfiguration(storage);
    expect(getResolverConfiguration(storage).services).toEqual([]);
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  test("merges a verified add into the latest stored order and state", async () => {
    const storage = new MemoryStorage();
    const verify = () => Promise.resolve(manifest());
    await addResolverService(
      { baseUrl: "https://one.example" },
      { storage, verify }
    );
    await addResolverService(
      { baseUrl: "https://two.example" },
      { storage, verify }
    );

    let finishVerification: ((value: ResolverManifest) => void) | undefined;
    const pending = addResolverService(
      { baseUrl: "https://pending.example" },
      {
        storage,
        verify: () =>
          new Promise((resolve) => {
            finishVerification = resolve;
          }),
      }
    );
    setResolverServiceEnabled("https://one.example", false, storage);
    reorderResolverServices(
      ["https://two.example", "https://one.example"],
      storage
    );
    removeResolverService("https://two.example", storage);
    finishVerification?.(manifest());

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
