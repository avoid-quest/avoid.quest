import { expect, mock, test } from "bun:test";
import { notifyStationSave } from "./station-save-notification";

test("warns when Session cleanup remains pending after a save", () => {
  const success = mock(() => undefined);
  const warning = mock(() => undefined);

  notifyStationSave(
    { sessionCleanupPending: true },
    'Saved "Radio" to collection',
    { success, warning }
  );

  expect(warning).toHaveBeenCalledWith(
    'Saved "Radio" to collection. Temporary station cleanup is still pending. Save again to retry.'
  );
  expect(success).not.toHaveBeenCalled();
});
