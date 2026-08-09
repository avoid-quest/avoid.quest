import { expect, test } from "@playwright/test";

test("new selections supersede old work and deactivation stays exclusive", async ({
  page,
}) => {
  await page.goto("/e2e/testbed.html");

  const events = await page.evaluate(async () => {
    const modulePath = "/src/lib/single-selection-coordinator.ts";
    const { getSingleSelectionCoordinator } = await import(modulePath);
    const coordinator = getSingleSelectionCoordinator({});
    const recorded: string[] = [];

    let markFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const first = coordinator.run(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          recorded.push("first:start");
          markFirstStarted();
          signal.addEventListener(
            "abort",
            () => {
              recorded.push("first:abort");
              resolve();
            },
            { once: true }
          );
        })
    );
    await firstStarted;
    const second = coordinator.run(() => {
      recorded.push("second:run");
      return Promise.resolve();
    });
    await Promise.all([first, second]);

    let markThirdStarted: () => void = () => undefined;
    const thirdStarted = new Promise<void>((resolve) => {
      markThirdStarted = resolve;
    });
    const third = coordinator.run(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          recorded.push("third:start");
          markThirdStarted();
          signal.addEventListener(
            "abort",
            () => {
              recorded.push("third:abort");
              resolve();
            },
            { once: true }
          );
        })
    );
    await thirdStarted;
    const deactivation = coordinator.cancelAndRun(async () => {
      recorded.push("deactivate:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      recorded.push("deactivate:end");
    });
    const ignored = coordinator.run(() => {
      recorded.push("ignored-selection");
      return Promise.resolve();
    });
    await Promise.all([third, deactivation, ignored]);

    return recorded;
  });

  expect(events).toEqual([
    "first:start",
    "first:abort",
    "second:run",
    "third:start",
    "third:abort",
    "deactivate:start",
    "deactivate:end",
  ]);
});
