import { eq, useLiveQuery } from "@tanstack/react-db";
import {
  addDismissedRadio,
  type RadioRecord,
  radiosCollection,
} from "@/lib/collections";

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
 * Get a single radio by ID.
 * NOTE: Uses useLiveQuery which doesn't support SSR.
 */
export function useRadio(id: string | null) {
  return useLiveQuery(
    (q) =>
      q
        .from({ radio: radiosCollection })
        .where(({ radio }) => eq(radio.id, id ?? "")),
    [id]
  );
}

/**
 * Add a new radio
 */
export function addRadio(radio: Omit<RadioRecord, "id">): void {
  radiosCollection.insert({
    id: crypto.randomUUID(),
    ...radio,
  });
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
 * Toggle radio enabled state
 */
export function toggleRadioEnabled(id: string): void {
  radiosCollection.update(id, (draft) => {
    draft.enabled = !draft.enabled;
  });
}

/**
 * Reorder radios
 */
export function reorderRadios(orderedIds: string[]): void {
  for (const [index, id] of orderedIds.entries()) {
    radiosCollection.update(id, (draft) => {
      draft.order = index;
    });
  }
}
