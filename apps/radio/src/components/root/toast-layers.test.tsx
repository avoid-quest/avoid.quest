/** biome-ignore-all lint/performance/noJsxPropsBind: Test harnesses record component interactions. */
import { expect, mock, test } from "bun:test";
import { installSettingsTestDom } from "../settings/settings-test-dom";

const scenario = process.env.AVOID_QUEST_TOAST_LAYER_TEST;

if (scenario) {
  installSettingsTestDom();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      matches: false,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
  window.scrollTo = () => undefined;
  // Toasts capture the pointer to track swipes; JSDOM has no pointer capture.
  Element.prototype.setPointerCapture = () => undefined;
  const { act, cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const { toast } = await import("@avoid.quest/ui/components/sonner");
  const { Toaster } = await import("@avoid.quest/ui/components/sonner");
  const { Dialog, DialogContent, DialogTitle } = await import(
    "@avoid.quest/ui/components/dialog"
  );
  const { Drawer, DrawerContent, DrawerTitle } = await import(
    "@avoid.quest/ui/components/drawer"
  );
  const { Popover, PopoverTrigger, PopoverContent } = await import(
    "@avoid.quest/ui/components/popover"
  );

  const layers = {
    dialog: (onOpenChange: (open: boolean) => void) => (
      <Dialog onOpenChange={onOpenChange} open={true}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Layer</DialogTitle>
        </DialogContent>
      </Dialog>
    ),
    drawer: (onOpenChange: (open: boolean) => void) => (
      <Drawer onOpenChange={onOpenChange} open={true}>
        <DrawerContent aria-describedby={undefined}>
          <DrawerTitle>Layer</DrawerTitle>
        </DrawerContent>
      </Drawer>
    ),
    popover: (onOpenChange: (open: boolean) => void) => (
      <Popover onOpenChange={onOpenChange} open={true}>
        <PopoverTrigger>Open layer</PopoverTrigger>
        <PopoverContent>
          <span>Layer</span>
          <input aria-label="Layer input" />
        </PopoverContent>
      </Popover>
    ),
  };

  test(`a toast action works while a ${scenario} is open, and real outside presses still dismiss it`, async () => {
    const onOpenChange = mock((_open: boolean) => undefined);
    const undo = mock(() => undefined);
    const view = render(
      <>
        {layers[scenario as keyof typeof layers](onOpenChange)}
        <Toaster />
      </>
    );
    try {
      await view.findByText("Layer");
      act(() => {
        toast.success('Hid "Sygma Radio"', {
          action: { label: "Undo", onClick: undo },
        });
      });
      const action = await view.findByRole("button", { name: "Undo" });
      // Modal layers disable pointer events on <body>; the toaster opts back in.
      expect(
        action
          .closest("[data-sonner-toaster]")
          ?.classList.contains("pointer-events-auto")
      ).toBe(true);
      // Let the layer finish installing its outside-interaction listeners.
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

      if (scenario === "popover") {
        const input = view.getByRole("textbox", { name: "Layer input" });
        act(() => input.focus());
        fireEvent.pointerDown(action);
        // Native focus() dispatches focusout on the old target with the toast
        // action as relatedTarget, just as keyboard focus navigation does.
        act(() => action.focus());
        await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
        expect(onOpenChange).not.toHaveBeenCalled();
      } else {
        fireEvent.pointerDown(action);
        fireEvent.focus(action);
      }

      fireEvent.click(action);
      expect(undo).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalled();

      fireEvent.pointerDown(document.body);
      fireEvent.click(document.body);
      await waitFor(() =>
        expect(onOpenChange.mock.calls.at(-1)?.[0]).toBe(false)
      );
    } finally {
      cleanup();
    }
  });
} else {
  test.each(["dialog", "drawer", "popover"])(
    "toast actions stay usable over a %s",
    async (layer) => {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: { ...process.env, AVOID_QUEST_TOAST_LAYER_TEST: layer },
        stderr: "pipe",
        stdout: "pipe",
        timeout: 10_000,
      });
      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ errors: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
        errors: "",
        exitCode: 0,
      });
    }
  );
}
