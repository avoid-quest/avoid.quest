import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { toast } from "@avoid.quest/ui/components/sonner";
import { radiosCollection } from "@/lib/collections/radios";
import { reorderRadios } from "./use-radios";

async function clearRadios() {
  await radiosCollection.stateWhenReady();
  const ids = [...radiosCollection.state.keys()];
  if (ids.length > 0) {
    await radiosCollection.delete(ids).isPersisted.promise;
  }
}

beforeEach(clearRadios);
afterEach(async () => {
  mock.restore();
  await clearRadios();
});

async function seedRadios() {
  await radiosCollection.insert(
    [0, 1, 2].map((order) => ({
      enabled: true,
      id: `reorder-${order}`,
      isSystem: false,
      name: `Station ${order}`,
      order,
      streamUrl: `https://example.com/${order}`,
    }))
  ).isPersisted.promise;
}

test("the reorder action persists all changed stations together", async () => {
  await seedRadios();
  const writes = spyOn(radiosCollection.utils, "acceptMutations");
  reorderRadios(["reorder-2", "reorder-1", "reorder-0"]);
  await Bun.sleep(0);
  expect(writes).toHaveBeenCalledTimes(1);
  expect(radiosCollection.state.get("reorder-0")?.order).toBe(2);
  expect(radiosCollection.state.get("reorder-1")?.order).toBe(1);
  expect(radiosCollection.state.get("reorder-2")?.order).toBe(0);
});

test("the reorder action reports async failure and rolls the order back", async () => {
  await seedRadios();
  const errorToast = spyOn(toast, "error").mockImplementation(() => "toast-id");
  spyOn(radiosCollection.utils, "acceptMutations").mockImplementation(() => {
    throw new Error("Storage full");
  });
  reorderRadios(["reorder-2", "reorder-1", "reorder-0"]);
  await Bun.sleep(0);
  expect(errorToast).toHaveBeenCalledWith("Couldn't reorder stations");
  expect(radiosCollection.state.get("reorder-0")?.order).toBe(0);
  expect(radiosCollection.state.get("reorder-2")?.order).toBe(2);
});
