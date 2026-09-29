// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
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
import { addDismissedRadios, type SyncChanges } from "@/lib/collections/radios";

type SyncDialogProps = {
  changes: SyncChanges;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (changes: SyncChanges) => void;
};

type SyncUpdate = SyncChanges["updates"][number];

function SyncUpdateRow({
  update: { existing, incoming },
  checked,
  onToggle,
}: {
  update: SyncUpdate;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const handleToggle = () => {
    onToggle(existing.id);
  };

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Checkbox
        checked={checked}
        id={`update-${existing.id}`}
        onCheckedChange={handleToggle}
      />
      <Label
        className="min-w-0 flex-1 cursor-pointer"
        htmlFor={`update-${existing.id}`}
      >
        <div className="truncate font-medium">{existing.name}</div>
        <div className="text-muted-foreground text-xs">
          {existing.streamUrl === incoming.streamUrl ? null : (
            <div>Stream URL changed</div>
          )}
          {existing.description === incoming.description ? null : (
            <div>Description updated</div>
          )}
          {existing.logoUrl === incoming.logoUrl ? null : (
            <div>Logo updated</div>
          )}
          {existing.websiteUrl === incoming.websiteUrl ? null : (
            <div>Website URL changed</div>
          )}
        </div>
      </Label>
    </div>
  );
}

type SyncAddition = SyncChanges["additions"][number];

function SyncAdditionRow({
  radio,
  checked,
  onToggle,
}: {
  radio: SyncAddition;
  checked: boolean;
  onToggle: (name: string) => void;
}) {
  const handleToggle = () => {
    onToggle(radio.name);
  };

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Checkbox
        checked={checked}
        id={`add-${radio.name}`}
        onCheckedChange={handleToggle}
      />
      <Label
        className="min-w-0 flex-1 cursor-pointer"
        htmlFor={`add-${radio.name}`}
      >
        <div className="truncate font-medium">{radio.name}</div>
        {radio.description ? (
          <div className="line-clamp-2 text-muted-foreground text-xs">
            {radio.description}
          </div>
        ) : null}
      </Label>
    </div>
  );
}

function getDescription(changes: SyncChanges) {
  const hasUpdates = changes.updates.length > 0;
  const hasAdditions = changes.additions.length > 0;

  const updated = `${changes.updates.length} updated`;
  const added = `${changes.additions.length} new`;
  if (hasUpdates && hasAdditions) {
    return `${updated}, ${added}`;
  }
  return hasUpdates ? updated : added;
}

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
      additions: changes.additions.filter((a) => selectedAdditions.has(a.name)),
      deletions: [], // Deletions are auto-applied, not shown in dialog
      updates: changes.updates.filter((u) =>
        selectedUpdates.has(u.existing.id)
      ),
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

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0 pr-8 sm:pr-0">
          <DialogTitle>Station updates</DialogTitle>
          <DialogDescription>{getDescription(changes)}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 pr-4">
          <div className="space-y-4 pb-1">
            {changes.updates.length > 0 && (
              <div className="space-y-2">
                <h4 className="flex items-center gap-2 font-medium text-sm">
                  <RefreshCwIcon className="size-4" />
                  Updated Radios
                </h4>
                <div className="space-y-2">
                  {changes.updates.map((update) => (
                    <SyncUpdateRow
                      checked={selectedUpdates.has(update.existing.id)}
                      key={update.existing.id}
                      onToggle={toggleUpdate}
                      update={update}
                    />
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
                    <SyncAdditionRow
                      checked={selectedAdditions.has(radio.name)}
                      key={radio.name}
                      onToggle={toggleAddition}
                      radio={radio}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 gap-2 sm:gap-0">
          <Button
            className="w-full sm:w-auto"
            onClick={handleSkip}
            variant="outline"
          >
            Skip
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={totalSelected === 0}
            onClick={handleApply}
          >
            Apply ({totalSelected})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
