// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { Checkbox } from "@avoid.quest/ui/components/checkbox";
import { Input } from "@avoid.quest/ui/components/input";
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
import { GripVerticalIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import {
  deleteRadio,
  reorderRadios,
  updateRadio,
  useAllRadios,
} from "@/lib/hooks/use-radios";
import { ConfirmDeleteDialog } from "../radio/confirm-delete-dialog";
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
    opacity: isDragging ? OPACITY_DRAGGING : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const handleToggle = (checked: boolean | "indeterminate") => {
    onToggle(radio, checked === true);
  };

  return (
    <div
      className={`flex items-center gap-2 px-1 py-2 transition-colors ${
        isDragging ? "bg-muted/50" : ""
      } ${disabled || radio.enabled === false ? "opacity-50" : ""}`}
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
      <RadioLogo logoUrl={radio.logoUrl} name={radio.name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{radio.name}</span>
          {radio.enabled === false ? (
            <span className="shrink-0 font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
              Hidden
            </span>
          ) : null}
        </div>
        <p className="truncate text-muted-foreground/60 text-xs">
          {[radio.placeTitle, radio.countryTitle].filter(Boolean).join(", ") ||
            radio.description}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <RadioItemActions
          disabled={disabled}
          onDelete={onDelete}
          onEdit={onEdit}
          radio={radio}
        />
        <Checkbox
          aria-label="Show in player"
          checked={radio.enabled ?? true}
          className="shrink-0"
          disabled={disabled}
          onCheckedChange={handleToggle}
        />
      </div>
    </div>
  );
}

const WHITESPACE = /\s+/;

export function RadioManagement() {
  const { data: radios } = useAllRadios();
  const [isUpdating, setIsUpdating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);
  const [filter, setFilter] = useState("");
  const filterTerms = filter.toLowerCase().split(WHITESPACE).filter(Boolean);
  const isFiltering = filterTerms.length > 0;
  const visibleRadios = (radios ?? []).filter((radio) => {
    const haystack = [
      radio.name,
      radio.description,
      radio.placeTitle,
      radio.countryTitle,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return filterTerms.every((term) => haystack.includes(term));
  });

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
    } catch {
      toast.error("Failed to update radio");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReorder = (reorderedRadios: Radio[]) => {
    setIsUpdating(true);
    try {
      // Get IDs in new order
      const orderedIds = reorderedRadios
        .map((radio) => (radio.id ? String(radio.id) : undefined))
        .filter((id): id is string => id !== undefined);

      reorderRadios(orderedIds);
    } catch {
      toast.error("Failed to reorder radios");
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
      toast.success(`Deleted "${deleteConfirm.name}"`);
    } catch {
      toast.error("Couldn't delete station");
    } finally {
      setIsUpdating(false);
      setDeleteConfirm(null);
    }
  };
  const handleCancelDelete = () => {
    setDeleteConfirm(null);
  };

  if (!radios) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground text-xs">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            aria-label="Filter stations"
            className="h-8 pl-8 text-xs"
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`Filter ${radios.length} stations…`}
            type="search"
            value={filter}
          />
        </div>
        <Button
          className="h-7"
          onClick={handleAddRadio}
          size="sm"
          variant="outline"
        >
          <PlusIcon className="size-3" />
          Add station
        </Button>
      </div>
      <div style={{ touchAction: "pan-y" }}>
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <SortableContext
            items={visibleRadios.map((radio) => radio.id?.toString() ?? "")}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y border-y">
              {visibleRadios.map((radio) => (
                <SortableRadioItem
                  disabled={isUpdating || isFiltering}
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

      <ConfirmDeleteDialog
        onCancel={handleCancelDelete}
        onConfirm={confirmDelete}
        radio={deleteConfirm}
      />
    </div>
  );
}
