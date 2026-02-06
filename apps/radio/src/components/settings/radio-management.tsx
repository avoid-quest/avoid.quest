import { Button } from "@avoid.quest/ui/components/button";
import { Checkbox } from "@avoid.quest/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PlusIcon, Volume2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import {
  deleteRadio,
  reorderRadios,
  updateRadio,
  useAllRadios,
} from "@/lib/hooks/use-radios";
import { RadioItemActions } from "../radio/radio-item-actions";
import { RadioLogo } from "../radio/radio-logo";

import { RadioDialog } from "./radio-dialog";

type SortableRadioItemProps = {
  radio: Radio;
  disabled?: boolean;
  onToggle: (radio: Radio, enabled: boolean) => void;
  onEdit: (radio: Radio) => void;
  onDelete: (radio: Radio) => void;
};

function SortableRadioItem({
  radio,
  disabled,
  onToggle,
  onEdit,
  onDelete,
}: SortableRadioItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: radio.id?.toString() ?? "" });

  const OPACITY_DRAGGING = 0.5;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? OPACITY_DRAGGING : 1,
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-border/50 bg-card/50 px-3 py-2 transition-colors ${
        isDragging ? "bg-muted/50" : ""
      } ${disabled ? "opacity-50" : ""}`}
      ref={setNodeRef}
      style={style}
    >
      <div
        className="cursor-grab touch-manipulation text-muted-foreground/50 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-3.5" />
      </div>
      <div className="shrink-0">
        <RadioLogo
          className="size-8"
          fallbackIcon={
            <Volume2Icon className="size-3 text-muted-foreground/40" />
          }
          logoUrl={radio.logoUrl}
          name={radio.name}
          size="sm"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{radio.name}</div>
        {radio.description?.trim() !== "" && (
          <div className="line-clamp-1 text-[10px] text-muted-foreground/60">
            {radio.description}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <RadioItemActions
          disabled={disabled}
          onDelete={onDelete}
          onEdit={onEdit}
          radio={radio}
        />
        <Checkbox
          checked={radio.enabled ?? true}
          className="shrink-0"
          disabled={disabled}
          onCheckedChange={(checked) => onToggle(radio, checked as boolean)}
        />
      </div>
    </div>
  );
}

export function RadioManagement() {
  const { data: radios } = useAllRadios();
  const [isUpdating, setIsUpdating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleToggleRadio = (radio: Radio, enabled: boolean) => {
    if (!radio.id) {
      return;
    }

    setIsUpdating(true);
    try {
      updateRadio(String(radio.id), { enabled });
      toast.success(`${radio.name} ${enabled ? "enabled" : "disabled"}`);
    } catch {
      toast.error("Failed to update radio");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !radios) {
      return;
    }

    const oldIndex = radios.findIndex(
      (radio) => radio.id?.toString() === active.id
    );
    const newIndex = radios.findIndex(
      (radio) => radio.id?.toString() === over.id
    );

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedRadios = arrayMove(radios, oldIndex, newIndex);
      handleReorder(reorderedRadios);
    }
  };

  const handleReorder = (reorderedRadios: Radio[]) => {
    setIsUpdating(true);
    try {
      // Get IDs in new order
      const orderedIds = reorderedRadios
        .map((r) => (r.id ? String(r.id) : undefined))
        .filter((id): id is string => id !== undefined);

      reorderRadios(orderedIds);
      toast.success("Radio order updated");
    } catch {
      toast.error("Failed to reorder radios");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAddRadio = () => {
    setDialogMode("create");
    setSelectedRadio(undefined);
    setDialogOpen(true);
  };

  const handleEditRadio = (radio: Radio) => {
    setDialogMode("edit");
    setSelectedRadio(radio);
    setDialogOpen(true);
  };

  const handleDeleteRadio = (radio: Radio) => {
    setDeleteConfirm(radio);
  };

  const confirmDelete = () => {
    if (!deleteConfirm?.id) {
      return;
    }

    setIsUpdating(true);
    try {
      deleteRadio(String(deleteConfirm.id));
      toast.success(`"${deleteConfirm.name}" deleted successfully`);
    } catch {
      toast.error("Failed to delete radio");
    } finally {
      setIsUpdating(false);
      setDeleteConfirm(null);
    }
  };

  if (!radios) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          Loading...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          Drag to reorder • Toggle to enable
        </p>
        <Button
          className="h-7"
          onClick={handleAddRadio}
          size="sm"
          variant="outline"
        >
          <PlusIcon className="mr-1 size-3" />
          Add Station
        </Button>
      </div>
      <div
        className="max-h-72 overflow-y-auto sm:max-h-full"
        style={{ touchAction: "pan-y" }}
      >
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <SortableContext
            items={radios.map((radio) => radio.id?.toString() ?? "")}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {radios.map((radio) => (
                <SortableRadioItem
                  disabled={isUpdating}
                  key={radio.id}
                  onDelete={handleDeleteRadio}
                  onEdit={handleEditRadio}
                  onToggle={handleToggleRadio}
                  radio={radio}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <RadioDialog
        mode={dialogMode}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        radio={selectedRadio}
      />

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <Dialog
          onOpenChange={() => setDeleteConfirm(null)}
          open={!!deleteConfirm}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Radio Station</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{deleteConfirm.name}"? This
                action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                onClick={() => setDeleteConfirm(null)}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={isUpdating}
                onClick={confirmDelete}
                size="sm"
                variant="destructive"
              >
                {isUpdating ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
