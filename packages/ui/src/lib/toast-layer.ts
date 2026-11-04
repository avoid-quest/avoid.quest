/**
 * Toasts float above every dialog, drawer and popover, so pressing one (its
 * Undo, say) is not an outside interaction that should dismiss the layer
 * underneath. Base UI roots cancel the corresponding onOpenChange event.
 * Vaul continues to use the DOM event guard below.
 */
export function isToastInteraction(event: Event): boolean {
  const focusTarget =
    event.type === "focusout" && "relatedTarget" in event
      ? event.relatedTarget
      : null;
  return [event.target, focusTarget].some(
    (target) =>
      target instanceof Element &&
      target.closest("[data-sonner-toaster]") !== null
  );
}

export function keepOpenOnToastInteraction(event: Event) {
  if (isToastInteraction(event)) {
    event.preventDefault();
  }
}
