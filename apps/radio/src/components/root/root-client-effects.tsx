import { useMidiControlLifecycle } from "@/lib/hooks/use-midi";

export function RootClientEffects() {
  useMidiControlLifecycle();
  return null;
}
