import { afterEach, beforeAll, expect, test } from "bun:test";

if (process.env.AVOID_QUEST_SUBSCRIPTION_REGRESSIONS) {
  const { act, cleanup, render } = await import("@testing-library/react");
  // @ts-expect-error jsdom types are not installed in this workspace.
  const { JSDOM } = await import("jsdom");
  const { initializeSettings, setMainDelayMs, setPlayerMode } = await import(
    "@/lib/collections/settings"
  );
  const {
    addSessionRadio,
    removeSessionRadio,
    sessionRadiosCollection,
    toSessionRadio,
  } = await import("@/lib/collections/session-radios");
  const { useSessionRadios, useSessionRadiosData } = await import(
    "./use-session-radios"
  );
  const {
    useAudioSettings,
    useDelaySettings,
    usePlayerMode,
    usePlayerModeState,
  } = await import("./use-settings");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://radio.test",
  });
  for (const [key, value] of Object.entries({
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    navigator: dom.window.navigator,
    window: dom.window,
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  });

  beforeAll(initializeSettings);
  afterEach(cleanup);

  test("mode-only consumers ignore delays while audio and delay consumers update", async () => {
    await act(() => {
      setPlayerMode("single");
      setMainDelayMs(0);
    });
    const renders = { audio: 0, delay: 0, mode: 0, state: 0 };
    function Mode() {
      renders.mode += 1;
      return <span>{usePlayerMode()}</span>;
    }
    function State() {
      renders.state += 1;
      return <span>{usePlayerModeState().mode}</span>;
    }
    function Audio() {
      renders.audio += 1;
      return <span>{useAudioSettings().delay?.mainDelayMs}</span>;
    }
    function Delay() {
      renders.delay += 1;
      return <span>{useDelaySettings().mainDelayMs}</span>;
    }
    render(
      <>
        <Mode />
        <State />
        <Audio />
        <Delay />
      </>
    );
    const before = { ...renders };
    await act(() => {
      setMainDelayMs(100);
    });
    expect(renders.mode).toBe(before.mode);
    expect(renders.state).toBe(before.state);
    expect(renders.audio).toBeGreaterThan(before.audio);
    expect(renders.delay).toBeGreaterThan(before.delay);
    await act(() => {
      setPlayerMode("node");
    });
    expect(renders.mode).toBeGreaterThan(before.mode);
    expect(renders.state).toBeGreaterThan(before.state);
  });

  test("session action and equal selector consumers ignore unrelated list changes", async () => {
    await sessionRadiosCollection.stateWhenReady();
    const id = "rb_subscription-regression";
    removeSessionRadio(id);
    let actionRenders = 0;
    let dataRenders = 0;
    let selectedRenders = 0;
    function Actions() {
      actionRenders += 1;
      useSessionRadios((state) => state.removeSessionRadio);
      return null;
    }
    function Data() {
      dataRenders += 1;
      useSessionRadiosData();
      return null;
    }
    function Selected() {
      selectedRenders += 1;
      useSessionRadios(
        (state) => ({
          radio: state.radios.find((radio) => radio.id === "absent"),
        }),
        (a, b) => a.radio === b.radio
      );
      return null;
    }
    render(
      <>
        <Actions />
        <Data />
        <Selected />
      </>
    );
    const before = { actionRenders, dataRenders, selectedRenders };
    await act(() => {
      addSessionRadio({
        id,
        name: "Regression",
        streamUrl: "https://radio.example/regression",
      });
    });
    expect(actionRenders).toBe(before.actionRenders);
    expect(selectedRenders).toBe(before.selectedRenders);
    expect(dataRenders).toBeGreaterThan(before.dataRenders);
    const record = sessionRadiosCollection.state.get(id);
    if (!record) {
      throw new Error("Missing session radio");
    }
    expect(toSessionRadio(record)).toBe(toSessionRadio(record));
    await act(() => {
      removeSessionRadio(id);
    });
    expect(actionRenders).toBe(before.actionRenders);
  });
} else {
  test("settings and session selectors isolate subscribers", async () => {
    // Other component suites replace these hooks; exercise their real subscriptions in isolation.
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, AVOID_QUEST_SUBSCRIPTION_REGRESSIONS: "1" },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 15_000,
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ errors: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      errors: "",
      exitCode: 0,
    });
  }, 20_000);
}
