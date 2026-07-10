import { describe, expect, mock, test } from "bun:test";
import { createDjRoutingLifecycleState } from "./dj-actions-routing";

describe("DJ routing lifecycle state", () => {
  test("deactivation unregisters routing errors and allows device restoration again", () => {
    const lifecycle = createDjRoutingLifecycleState();
    const unregisterFirst = mock(() => undefined);
    const unregisterSecond = mock(() => undefined);

    expect(lifecycle.beginAudioDeviceInitialization()).toBe(true);
    expect(lifecycle.beginAudioDeviceInitialization()).toBe(false);
    lifecycle.replaceOutputRouterErrorListener(() => unregisterFirst);
    lifecycle.replaceOutputRouterErrorListener(() => unregisterSecond);

    expect(unregisterFirst).toHaveBeenCalledTimes(1);
    lifecycle.cleanup();

    expect(unregisterSecond).toHaveBeenCalledTimes(1);
    expect(lifecycle.beginAudioDeviceInitialization()).toBe(true);
  });
});
