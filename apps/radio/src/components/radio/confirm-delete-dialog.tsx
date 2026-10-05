/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import type { Radio } from "@/lib/audio";

type ConfirmDeleteDialogProps = {
  radio: Radio | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDeleteDialog({
  radio,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onCancel();
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={Boolean(radio)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{radio?.name}&rdquo;?</DialogTitle>
          <DialogDescription>This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} size="sm" variant="outline">
            Cancel
          </Button>
          <Button onClick={onConfirm} size="sm" variant="destructive">
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
