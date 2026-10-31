import { afterEach, expect, mock, test } from "bun:test";
import { browserTestGlobals } from "@/test-utils/browser-globals";
import { installSettingsTestDom } from "./settings-test-dom";

if (process.env.AVOID_QUEST_AUDIO_OUTPUT_LABEL_TEST) {
  const dom = installSettingsTestDom();
  for (const [key, value] of Object.entries(browserTestGlobals(dom.window))) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  let outputDevices: { deviceId: string; label: string }[] = [];
  let savedOutput: { mainOutputId: string; cueOutputId: string | null } = {
    mainOutputId: "disconnected-main",
    cueOutputId: "disconnected-cue",
  };
  const applyMain = mock(() => Promise.resolve());
  const applyCue = mock(() => Promise.resolve());
  mock.module("@/lib/audio", () => ({
    captureMobileAudioDiagnostic: () => Promise.resolve({}),
    useAudioDevices: () => ({
      outputDevices,
      permissionState: "granted",
      isLoading: false,
      requestPermission: () => Promise.resolve(),
      refreshDevices: () => Promise.resolve(),
    }),
  }));
  mock.module("@/lib/collections", () => ({
    getAudioSettings: () => savedOutput,
    getDelaySettings: () => ({ mainDelayMs: 0, cueDelayMs: 0 }),
  }));
  mock.module("@/lib/dj-actions", () => ({
    applyMainOutputDevice: applyMain,
    applyCueOutputDevice: applyCue,
    autoCompensateLatency: () => Promise.resolve(null),
    setMainOutputDelay: () => Promise.resolve(),
    setCueOutputDelay: () => Promise.resolve(),
  }));
  mock.module("@/lib/output-routing.js", () => ({
    getOutputRouting: () => ({
      getSnapshot: () => ({ sinkSelectionSupported: true }),
    }),
  }));
  const { cleanup, render } = await import("@testing-library/react");
  const { AudioSettings } = await import("./audio-settings");
  afterEach(cleanup);

  test("missing output devices show placeholders and recover labels after enumeration", () => {
    const view = render(<AudioSettings />);
    const main = view.getByRole("combobox", { name: "Main output" });
    const cue = view.getByRole("combobox", { name: "CUE output" });
    expect(main.textContent).toContain("Select output device");
    expect(cue.textContent).toContain("Select CUE output");

    outputDevices = [
      { deviceId: "disconnected-main", label: "Studio speakers" },
      { deviceId: "disconnected-cue", label: "USB headphones" },
    ];
    view.rerender(<AudioSettings />);
    expect(main.textContent).toContain("Studio speakers");
    expect(cue.textContent).toContain("USB headphones");

    outputDevices = [];
    view.rerender(<AudioSettings />);
    expect(main.textContent).toContain("Select output device");
    expect(cue.textContent).toContain("Select CUE output");
    expect(applyMain).not.toHaveBeenCalled();
    expect(applyCue).not.toHaveBeenCalled();
  });

  test("system default and CUE off remain labelled without enumerated devices", () => {
    savedOutput = { mainOutputId: "default", cueOutputId: null };
    const view = render(<AudioSettings />);
    expect(
      view.getByRole("combobox", { name: "Main output" }).textContent
    ).toContain("System default");
    expect(
      view.getByRole("combobox", { name: "CUE output" }).textContent
    ).toContain("Off");
  });
} else {
  test("audio output labels remain readable as devices disappear and return", async () => {
    // Module mocks stay isolated from the full audio and playback test suites.
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, AVOID_QUEST_AUDIO_OUTPUT_LABEL_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ errors: exitCode ? stderr : "", exitCode }).toEqual({
      errors: "",
      exitCode: 0,
    });
  });
}
