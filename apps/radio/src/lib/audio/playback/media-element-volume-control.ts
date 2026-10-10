/**
 * iOS locks media volume to the device buttons. WebKit accepts volume writes
 * and restores them later, so only `:volume-locked` reports the lock.
 */
export function isMediaVolumeLocked(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof CSS !== "undefined" &&
    CSS.supports("selector(:volume-locked)") &&
    document.createElement("audio").matches(":volume-locked")
  );
}
