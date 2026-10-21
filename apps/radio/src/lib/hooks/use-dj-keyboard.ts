import { useEffect } from "react";
import { getAudioSettings } from "@/lib/collections";
import { getDjDeckModule } from "@/lib/dj-deck";

const SHORTCUT_INTERACTION_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="combobox"]';

/**
 * Keyboard shortcuts for DJ mode:
 * - Q: Toggle Deck A CUE (pre-fader listen)
 * - W: Toggle Deck B CUE (pre-fader listen)
 *
 * Shortcuts are disabled when typing in input fields.
 */
export function useDjKeyboard() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { target } = e;
      if (
        e.defaultPrevented ||
        !(target instanceof Element) ||
        target.closest(SHORTCUT_INTERACTION_SELECTOR)
      ) {
        return;
      }

      // Ignore if modifier keys are pressed (except shift for uppercase)
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // CUE shortcuts only work when a CUE output device is configured
      if (!getAudioSettings().cueOutputId) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "q":
          e.preventDefault();
          getDjDeckModule().deck("deck-a").change({ type: "cue" });
          break;
        case "w":
          e.preventDefault();
          getDjDeckModule().deck("deck-b").change({ type: "cue" });
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
