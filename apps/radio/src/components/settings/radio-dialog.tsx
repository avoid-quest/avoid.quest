// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import type { Radio } from "@/lib/audio";
import { StationEditor } from "./station-editor";

export { prefetchStationDialogOnIntent } from "./station-editor";

type RadioDialogProps = {
  mode: "create" | "edit";
  radio?: Radio;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RadioDialog({
  mode,
  radio,
  open,
  onOpenChange,
}: RadioDialogProps) {
  const handleClose = () => {
    onOpenChange(false);
  };

  const isEdit = mode === "edit";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] w-full max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEdit ? "Edit station" : "Add station"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update station details."
              : "Search Radio Garden, fetch from a URL, or enter details manually."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <StationEditor mode={mode} onClose={handleClose} radio={radio} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
