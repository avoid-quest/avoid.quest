import { expect, test } from "@playwright/test";

test("boots the installed openDAW runtime and binds a real sidechain", async ({
  page,
}) => {
  await page.goto("/e2e/testbed.html");
  await page.evaluate(() => {
    const start = document.createElement("button");
    start.id = "start-audio";
    start.textContent = "Start audio";
    start.addEventListener(
      "click",
      () => {
        const testGlobal = globalThis as typeof globalThis & {
          __effectsAudioContext?: AudioContext;
        };
        testGlobal.__effectsAudioContext = new AudioContext();
      },
      { once: true }
    );
    document.body.append(start);
  });
  await page.locator("#start-audio").click();

  const result = await page.evaluate(async () => {
    const runtimeModulePath =
      "/src/lib/audio/manager/official-opendaw-runtime.ts";
    const registryModulePath = "/src/lib/audio/dsp/effects/registry.ts";
    const [{ OfficialOpenDawRuntime }, { createDefaultEffectConfig }] =
      await Promise.all([
        import(runtimeModulePath),
        import(registryModulePath),
      ]);
    const testGlobal = globalThis as typeof globalThis & {
      __effectsAudioContext?: AudioContext;
    };
    const context = testGlobal.__effectsAudioContext;
    if (!context) {
      throw new Error("The user-activated AudioContext was not created");
    }
    if (!globalThis.crossOriginIsolated) {
      throw new Error("The openDAW testbed must be cross-origin isolated");
    }

    const runtime = new OfficialOpenDawRuntime(context);
    try {
      await context.resume();
      await runtime.initialize();

      const targetSource = context.createGain();
      const targetDestination = context.createGain();
      targetDestination.connect(context.destination);
      const sidechainSource = context.createGain();
      const connected = await runtime.connectSound(
        "target",
        targetSource,
        targetDestination
      );
      const sidechainConnected = await runtime.connectSidechainSource(
        "sidechain",
        sidechainSource
      );

      const compressor = createDefaultEffectConfig(
        "compressor",
        "compressor-1",
        0
      );
      compressor.enabled = true;
      compressor.sidechain = { channelId: "sidechain" };
      runtime.syncEffects("target", [compressor]);
      runtime.setSidechainTarget("target", "sidechain");
      runtime.setDryWet("target", 0.75);
      runtime.setTempo(128);

      const soundCountWithSidechain = runtime.soundCount;
      runtime.deleteSound("sidechain");
      runtime.deleteSound("target");
      return {
        connected,
        ready: runtime.isReady,
        sidechainConnected,
        soundCountAfterDelete: runtime.soundCount,
        soundCountWithSidechain,
      };
    } finally {
      runtime.cleanup();
      await context.close();
      Reflect.deleteProperty(testGlobal, "__effectsAudioContext");
    }
  });

  expect(result).toEqual({
    connected: true,
    ready: true,
    sidechainConnected: true,
    soundCountAfterDelete: 0,
    soundCountWithSidechain: 2,
  });
});
