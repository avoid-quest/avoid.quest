import { toast } from "sonner";

type StationSaveNotifier = {
  success: (message: string) => unknown;
  warning: (message: string) => unknown;
};

export function notifyStationSave(
  data: { sessionCleanupPending?: true },
  successMessage: string,
  notifier: StationSaveNotifier = toast
): void {
  if (data.sessionCleanupPending) {
    notifier.warning(
      `${successMessage}. Temporary station cleanup is still pending. Save again to retry.`
    );
    return;
  }
  notifier.success(successMessage);
}
