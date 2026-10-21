import { captureError } from "@avoid.quest/error";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { toast } from "sonner";
import {
  addDismissedRadio,
  reorderRadios as persistRadioOrder,
  type RadioRecord,
  radiosCollection,
} from "@/lib/collections/radios";

/**
 * Get all enabled radios sorted by order.
 * NOTE: Uses useLiveQuery which doesn't support SSR.
 * Components using this hook should be wrapped in <ClientOnly> or use ssr: false routes.
 */
export function useEnabledRadios() {
  return useLiveQuery((q) =>
    q
      .from({ radio: radiosCollection })
      .where(({ radio }) => eq(radio.enabled, true))
      .orderBy(({ radio }) => radio.order, "asc")
  );
}

/**
 * Get all radios sorted by order.
 * NOTE: Uses useLiveQuery which doesn't support SSR.
 */
export function useAllRadios() {
  return useLiveQuery((q) =>
    q
      .from({ radio: radiosCollection })
      .orderBy(({ radio }) => radio.order, "asc")
  );
}

/**
 * Update a radio
 */
export function updateRadio(
  id: string,
  updates: Partial<Omit<RadioRecord, "id">>
): void {
  radiosCollection.update(id, (draft) => {
    Object.assign(draft, updates);
  });
}

/**
 * Delete a radio.
 * If it's a system radio, adds it to the dismissed list to prevent re-prompting.
 */
export function deleteRadio(id: string): void {
  const radio = radiosCollection.state.get(id);
  if (radio?.isSystem) {
    addDismissedRadio(radio.name);
  }
  radiosCollection.delete(id);
}

/**
 * Reorder radios
 */
export function reorderRadios(orderedIds: string[]): void {
  persistRadioOrder(orderedIds).catch((error) => {
    captureError(error, { operation: "reorderRadios", surface: "ui" });
    toast.error("Couldn't reorder stations");
  });
}
