/**
 * Small dot indicating a MIDI mapping exists for a control.
 */

export function MidiBadge() {
  return (
    <span className="pointer-events-none absolute top-0 right-0 z-10 size-2 rounded-full bg-primary ring-2 ring-background" />
  );
}
