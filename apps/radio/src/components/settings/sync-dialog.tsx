import { Button } from "@avoid.quest/ui/components/button";
import { Checkbox } from "@avoid.quest/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import { Label } from "@avoid.quest/ui/components/label";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { addDismissedRadios, type SyncChanges } from "@/lib/collections";

type SyncDialogProps = {
  changes: SyncChanges;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (changes: SyncChanges) => void;
};

export function SyncDialog({
  changes,
  open,
  onOpenChange,
  onApply,
}: SyncDialogProps) {
  // Track which items are selected for sync
  const [selectedUpdates, setSelectedUpdates] = useState<Set<string>>(
    new Set(changes.updates.map((u) => u.existing.id))
  );
  const [selectedAdditions, setSelectedAdditions] = useState<Set<string>>(
    new Set(changes.additions.map((a) => a.name))
  );

  const toggleUpdate = (id: string) => {
    setSelectedUpdates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAddition = (name: string) => {
    setSelectedAdditions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleApply = () => {
    // Track unselected additions as dismissed so they don't re-appear
    const skippedAdditions = changes.additions
      .filter((a) => !selectedAdditions.has(a.name))
      .map((a) => a.name);
    if (skippedAdditions.length > 0) {
      addDismissedRadios(skippedAdditions);
    }

    const filteredChanges: SyncChanges = {
      updates: changes.updates.filter((u) =>
        selectedUpdates.has(u.existing.id)
      ),
      additions: changes.additions.filter((a) => selectedAdditions.has(a.name)),
      deletions: [], // Deletions are auto-applied, not shown in dialog
    };
    onApply(filteredChanges);
    onOpenChange(false);
  };

  const handleSkip = () => {
    // Track all additions as dismissed so they don't re-appear
    const allAdditionNames = changes.additions.map((a) => a.name);
    if (allAdditionNames.length > 0) {
      addDismissedRadios(allAdditionNames);
    }
    onOpenChange(false);
  };

  const totalSelected = selectedUpdates.size + selectedAdditions.size;
  const totalChanges = changes.updates.length + changes.additions.length;

  const getDescription = () => {
    const hasUpdates = changes.updates.length > 0;
    const hasAdditions = changes.additions.length > 0;

    if (hasUpdates && hasAdditions) {
      return `${changes.updates.length} radio(s) updated, ${changes.additions.length} new radio(s) available`;
    }
    if (hasUpdates) {
      return `${changes.updates.length} radio(s) have updated metadata`;
    }
    return `${changes.additions.length} new radio(s) available`;
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Radio Updates Available</DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[300px] pr-4">
          <div className="space-y-4">
            {changes.updates.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-2 font-medium text-sm">
                  <RefreshCwIcon className="size-4" />
                  Updated Radios
                </h4>
                <div className="space-y-2">
                  {changes.updates.map(({ existing, incoming }) => (
                    <div
                      className="flex items-start gap-3 rounded-lg border p-3"
                      key={existing.id}
                    >
                      <Checkbox
                        checked={selectedUpdates.has(existing.id)}
                        id={`update-${existing.id}`}
                        onCheckedChange={() => toggleUpdate(existing.id)}
                      />
                      <Label
                        className="flex-1 cursor-pointer"
                        htmlFor={`update-${existing.id}`}
                      >
                        <div className="font-medium">{existing.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {existing.streamUrl !== incoming.streamUrl && (
                            <div>Stream URL changed</div>
                          )}
                          {existing.description !== incoming.description && (
                            <div>Description updated</div>
                          )}
                          {existing.logoUrl !== incoming.logoUrl && (
                            <div>Logo updated</div>
                          )}
                          {existing.websiteUrl !== incoming.websiteUrl && (
                            <div>Website URL changed</div>
                          )}
                        </div>
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {changes.additions.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-2 font-medium text-sm">
                  <PlusIcon className="size-4" />
                  New Radios
                </h4>
                <div className="space-y-2">
                  {changes.additions.map((radio) => (
                    <div
                      className="flex items-start gap-3 rounded-lg border p-3"
                      key={radio.name}
                    >
                      <Checkbox
                        checked={selectedAdditions.has(radio.name)}
                        id={`add-${radio.name}`}
                        onCheckedChange={() => toggleAddition(radio.name)}
                      />
                      <Label
                        className="flex-1 cursor-pointer"
                        htmlFor={`add-${radio.name}`}
                      >
                        <div className="font-medium">{radio.name}</div>
                        {radio.description && (
                          <div className="line-clamp-2 text-muted-foreground text-xs">
                            {radio.description}
                          </div>
                        )}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button onClick={handleSkip} variant="outline">
            Skip
          </Button>
          <Button disabled={totalSelected === 0} onClick={handleApply}>
            Apply Selected ({totalSelected}/{totalChanges})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
