import { expect, test } from "@playwright/test";

test("interrupts an effects ramp on the audio clock without a discontinuity", async ({
  page,
}) => {
  await page.goto("/e2e/testbed.html");

  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/audio/manager/effects-backend-router.ts";
    const { EffectsBackendRouter } = await import(modulePath);
    const sampleRate = 48_000;
    const context = new OfflineAudioContext(1, sampleRate * 0.08, sampleRate);
    const source = context.createConstantSource();
    source.offset.value = 1;
    const router = new EffectsBackendRouter(source, context.destination, true);
    const settled: string[] = [];
    let markMutedSettled: () => void = () => undefined;
    const mutedSettled = new Promise<void>((resolve) => {
      markMutedSettled = resolve;
    });

    router.switchTo("bypass", () => settled.push("bypass"));
    const interruption = context.suspend(0.015).then(() => {
      router.switchTo("muted", () => {
        settled.push("muted");
        markMutedSettled();
      });
      return context.resume();
    });
    source.start();
    const rendered = await context.startRendering();
    await interruption;
    await mutedSettled;

    const samples = rendered.getChannelData(0);
    const sampleAt = (seconds: number) =>
      samples[Math.round(seconds * sampleRate)];
    return {
      afterInterruption: sampleAt(0.016),
      beforeInterruption: sampleAt(0.014),
      final: sampleAt(0.06),
      settled,
    };
  });

  expect(result.beforeInterruption).toBeGreaterThan(0.4);
  expect(result.afterInterruption).toBeGreaterThan(0.4);
  expect(
    Math.abs(result.afterInterruption - result.beforeInterruption)
  ).toBeLessThan(0.08);
  expect(Math.abs(result.final)).toBeLessThan(0.001);
  expect(result.settled).toEqual(["muted"]);
});
