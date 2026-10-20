import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { installAnimationTestEnvironment } from "@/components/radio/dj/shared/animation-test-utils";
// biome-ignore lint/performance/noNamespaceImport: spy on the settings read at the keyboard boundary.
import * as collections from "@/lib/collections";
import { getDjDeckModule } from "@/lib/dj-deck";
import { useDjKeyboard } from "./use-dj-keyboard";

afterEach(cleanup);

test("holding Q or W does not repeatedly toggle cue", () => {
  const clock = installAnimationTestEnvironment();
  const settings = spyOn(collections, "getAudioSettings").mockReturnValue({
    ...collections.getAudioSettings(),
    cueOutputId: "headphones",
  });
  const deckA = spyOn(
    getDjDeckModule().deck("deck-a"),
    "change"
  ).mockImplementation(() => undefined);
  const deckB = spyOn(
    getDjDeckModule().deck("deck-b"),
    "change"
  ).mockImplementation(() => undefined);
  try {
    renderHook(useDjKeyboard);
    for (const key of ["q", "w"]) {
      fireEvent.keyDown(document.body, { key });
      for (let i = 0; i < 10; i += 1) {
        fireEvent.keyDown(document.body, { key, repeat: true });
      }
    }
    expect(deckA).toHaveBeenCalledTimes(1);
    expect(deckB).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    settings.mockRestore();
    deckA.mockRestore();
    deckB.mockRestore();
    clock.restore();
  }
});

test("cue shortcuts defer to dialogs, menu typeahead and prevented events", () => {
  const clock = installAnimationTestEnvironment();
  const settings = spyOn(collections, "getAudioSettings").mockReturnValue({
    ...collections.getAudioSettings(),
    cueOutputId: "headphones",
  });
  const changeA = spyOn(
    getDjDeckModule().deck("deck-a"),
    "change"
  ).mockImplementation(() => undefined);
  const changeB = spyOn(
    getDjDeckModule().deck("deck-b"),
    "change"
  ).mockImplementation(() => undefined);
  try {
    renderHook(useDjKeyboard);
    for (const role of [
      "dialog",
      "menu",
      "menuitem",
      "listbox",
      "option",
      "combobox",
    ]) {
      const parent = document.createElement("div");
      parent.setAttribute("role", role);
      const child = document.createElement("button");
      parent.appendChild(child);
      document.body.appendChild(parent);
      fireEvent.keyDown(child, { key: "q" });
      fireEvent.keyDown(child, { key: "w" });
      parent.remove();
    }
    const select = document.createElement("select");
    document.body.appendChild(select);
    fireEvent.keyDown(select, { key: "q" });
    const button = document.createElement("button");
    button.addEventListener("keydown", (event) => event.preventDefault());
    document.body.appendChild(button);
    fireEvent.keyDown(button, { key: "w" });
    expect(changeA).not.toHaveBeenCalled();
    expect(changeB).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "q" });
    fireEvent.keyDown(document.body, { key: "w" });
    expect(changeA).toHaveBeenCalledTimes(1);
    expect(changeB).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    settings.mockRestore();
    changeA.mockRestore();
    changeB.mockRestore();
    clock.restore();
  }
});
