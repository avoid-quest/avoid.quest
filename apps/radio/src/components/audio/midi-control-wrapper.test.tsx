import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { Profiler } from "react";
import { installAnimationTestEnvironment } from "@/components/radio/dj/shared/animation-test-utils";
import { createDefaultEffectConfig } from "@/lib/audio";
import { getMidiControl } from "@/lib/midi";

let MidiControlWrapper: typeof import("./midi-control-wrapper")["MidiControlWrapper"];
beforeAll(async () => {
  const environment = installAnimationTestEnvironment();
  ({ MidiControlWrapper } = await import("./midi-control-wrapper"));
  environment.restore();
});

let clock: ReturnType<typeof installAnimationTestEnvironment>;
beforeEach(() => {
  clock = installAnimationTestEnvironment();
});
afterEach(async () => {
  cleanup();
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  getMidiControl().cleanup();
  clock.restore();
});

test("effect parameter edits and another target's learning leave wrapped controls idle", () => {
  const control = getMidiControl();
  const effect = createDefaultEffectConfig("limiter", "limiter", 0);
  const binding = control.bindDeckEffects("deck-a");
  binding.reconcile([effect]);
  const commits = mock(() => undefined);
  render(
    <Profiler id="wrapper" onRender={commits}>
      <MidiControlWrapper targetId="deck-a:volume">
        <span>Volume</span>
      </MidiControlWrapper>
    </Profiler>
  );
  const baseline = commits.mock.calls.length;
  for (let i = 0; i < 60; i += 1) {
    act(() => binding.reconcile([{ ...effect, threshold: -i }]));
  }
  act(() => control.change({ targetId: "deck-b:volume", type: "start-learn" }));
  expect(commits.mock.calls.length).toBe(baseline);
  act(() => control.change({ targetId: "deck-a:volume", type: "start-learn" }));
  expect(commits.mock.calls.length).toBeGreaterThan(baseline);
});

test("keyboard menu selection opens a labelled transform dialog and restores control focus", async () => {
  const control = getMidiControl();
  control.change({ presetId: "pioneer-ddj-200", type: "load-preset" });
  const view = render(
    <MidiControlWrapper targetId="deck-a:volume">
      <button type="button">Deck volume</button>
    </MidiControlWrapper>
  );
  const origin = view.getByRole("button", { name: "Deck volume" });
  act(() => origin.focus());
  // Browsers dispatch contextmenu for the keyboard context-menu command.
  fireEvent.contextMenu(origin);
  const edit = await view.findByRole("menuitem", { name: "Edit transform" });
  act(() => edit.focus());
  fireEvent.keyDown(edit, { key: "Enter" });
  const dialog = await view.findByRole("dialog", {
    name: "Edit MIDI transform",
  });
  const invert = view.getByRole("switch", { name: "Invert" });
  await waitFor(() => expect(document.activeElement).toBe(invert));
  fireEvent.keyDown(invert, { key: " " });
  // Space on a native button dispatches click; jsdom does not run browser default actions.
  fireEvent.click(invert);
  expect(
    control.getTargetSnapshot("deck-a:volume").mapping?.transform?.invert
  ).toBe(true);
  expect(fireEvent.keyDown(invert, { key: "Tab" })).toBe(true);
  const minimum = view.getByRole("slider", { name: "Transform minimum" });
  act(() => minimum.focus());
  fireEvent.keyDown(minimum, { key: "ArrowRight" });
  expect(
    control.getTargetSnapshot("deck-a:volume").mapping?.transform?.min
  ).toBeGreaterThan(0);
  expect(fireEvent.keyDown(minimum, { key: "Tab" })).toBe(true);
  const maximum = view.getByRole("slider", { name: "Transform maximum" });
  act(() => maximum.focus());
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(maximum, { key: "Tab" });
  const curve = view.getByRole("combobox", { name: "Curve" });
  act(() => curve.focus());
  fireEvent.keyDown(curve, { key: "ArrowDown" });
  expect(await view.findByRole("listbox")).toBeTruthy();
  fireEvent.keyDown(view.getByRole("option", { name: "Logarithmic" }), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(
      control.getTargetSnapshot("deck-a:volume").mapping?.transform?.curve
    ).toBe("log")
  );
  fireEvent.keyDown(view.getByRole("button", { name: "Reset transform" }), {
    key: "Escape",
  });
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(origin));
});
