/**
 * Toasts float above every dialog, drawer and popover, so pressing one (its
 * Undo, say) is not an outside interaction that should dismiss the layer
 * underneath. Call from a Radix `onInteractOutside` handler.
 */
export function keepOpenOnToastInteraction(event: Event) {
  if (
    event.target instanceof Element &&
    event.target.closest("[data-sonner-toaster]")
  ) {
    event.preventDefault();
  }
}
