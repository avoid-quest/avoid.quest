/**
 * Small violet dot indicating a MIDI mapping exists for a control.
 */

export function MidiBadge() {
  return (
    <span className="pointer-events-none absolute top-0 right-0 z-10 size-2 rounded-full bg-violet-500 shadow-[0_0_4px_rgba(139,92,246,0.5)]" />
  );
}
