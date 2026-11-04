// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { Checkbox } from "@avoid.quest/ui/components/checkbox";
import { toast } from "@avoid.quest/ui/components/sonner";
import type {
  Announcements,
  DragEndEvent,
  UniqueIdentifier,
} from "@dnd-kit/core";
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
import { IconArrowLeft, IconGripVertical, IconPlus } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
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
import { SearchField } from "../radio/search-field";
import { stationFallbackSubtitle } from "../radio/station-row";

import { StationEditor } from "./station-editor";

type SortableRadioItemProps = {
  radio: Radio;
  disabled?: boolean;
  sortDisabled?: boolean;
  onToggle: (radio: Radio, enabled: boolean) => void;
  onEdit: (radio: Radio) => void;
  onDelete: (radio: Radio) => void;
};

function SortableRadioItem({
  radio,
  disabled,
  sortDisabled,
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
  } = useSortable({ disabled: sortDisabled, id: radio.id?.toString() ?? "" });

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
      <button
        aria-label={`Reorder ${radio.name}`}
        className="flex size-8 shrink-0 cursor-grab touch-none select-none items-center justify-center text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing [@media(pointer:coarse)]:size-11"
        type="button"
        {...attributes}
        {...listeners}
      >
        <IconGripVertical className="size-3.5" />
      </button>
      <RadioLogo
        decorative
        logoUrl={radio.logoUrl}
        name={radio.name}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{radio.name}</span>
          {radio.enabled === false ? (
            <span className="shrink-0 text-muted-foreground text-xs">
              Hidden
            </span>
          ) : null}
        </div>
        <p className="truncate text-muted-foreground text-xs">
          {stationFallbackSubtitle(radio)}
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
          aria-label={`Show ${radio.name} in player`}
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

function stationName(radios: Radio[] | undefined, id: UniqueIdentifier) {
  return (
    radios?.find((radio) => radio.id?.toString() === String(id))?.name ??
    "Station"
  );
}

export function RadioManagement({ defaultPage }: { defaultPage?: "create" }) {
  const { data: radios } = useAllRadios();
  // Screen readers hear station names, not record ids, while reordering.
  const reorderAnnouncements: Announcements = {
    onDragCancel: ({ active }) =>
      `Moving ${stationName(radios, active.id)} was cancelled.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${stationName(radios, active.id)} moved to the place of ${stationName(radios, over.id)}.`
        : `${stationName(radios, active.id)} was dropped.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${stationName(radios, active.id)} is over ${stationName(radios, over.id)}.`
        : undefined,
    onDragStart: ({ active }) => `Picked up ${stationName(radios, active.id)}.`,
  };
  const [isUpdating, setIsUpdating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(defaultPage === "create");
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editorOpen);
  useEffect(() => {
    if (wasEditing.current && !editorOpen) {
      addButtonRef.current?.focus();
    }
    wasEditing.current = editorOpen;
  }, [editorOpen]);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
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
      toast.error("Couldn't update station");
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
      toast.error("Couldn't reorder stations");
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
    setEditorMode("create");
    setSelectedRadio(undefined);
    setEditorOpen(true);
  };

  const handleEditRadio = (radio: Radio) => {
    setEditorMode("edit");
    setSelectedRadio(radio);
    setEditorOpen(true);
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
  const handleCloseEditor = () => setEditorOpen(false);

  if (editorOpen) {
    return (
      <StationEditorPage
        mode={editorMode}
        onClose={handleCloseEditor}
        radio={selectedRadio}
      />
    );
  }

  if (!radios) {
    return <LoadingFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SearchField
          aria-label="Filter stations"
          className="min-w-0 flex-1"
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Filter ${radios.length} stations…`}
          value={filter}
        />
        <Button
          onClick={handleAddRadio}
          ref={addButtonRef}
          size="sm"
          variant="outline"
        >
          <IconPlus />
          Add station
        </Button>
      </div>
      <div style={{ touchAction: "pan-y" }}>
        <DndContext
          accessibility={{
            announcements: reorderAnnouncements,
            screenReaderInstructions: {
              draggable:
                "To reorder, press Space or Enter, move with the arrow keys, then press Space or Enter again. Escape cancels.",
            },
          }}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <SortableContext
            items={visibleRadios.map((radio) => radio.id?.toString() ?? "")}
            strategy={verticalListSortingStrategy}
          >
            {visibleRadios.length > 0 ? (
              <div className="divide-y border-y">
                {visibleRadios.map((radio) => (
                  <SortableRadioItem
                    disabled={isUpdating}
                    key={radio.id}
                    onDelete={handleDeleteRadio}
                    onEdit={handleEditRadio}
                    onToggle={handleToggleRadio}
                    radio={radio}
                    sortDisabled={isFiltering}
                  />
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-muted-foreground text-xs">
                No stations found
              </p>
            )}
          </SortableContext>
        </DndContext>
      </div>

      <ConfirmDeleteDialog
        onCancel={handleCancelDelete}
        onConfirm={confirmDelete}
        radio={deleteConfirm}
      />
    </div>
  );
}

function StationEditorPage({
  mode,
  radio,
  onClose,
}: {
  mode: "create" | "edit";
  radio?: Radio;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <div className="space-y-4">
      <Button onClick={onClose} size="sm" type="button" variant="ghost">
        <IconArrowLeft aria-hidden="true" /> My stations
      </Button>
      <h2
        className="font-medium text-sm outline-none"
        ref={headingRef}
        tabIndex={-1}
      >
        {mode === "create" ? "Add station" : "Edit station"}
      </h2>
      <p className="text-muted-foreground text-xs">
        {mode === "create"
          ? "Search Radio Garden, fetch from a URL, or enter details manually."
          : "Update station details."}
      </p>
      <StationEditor mode={mode} onClose={onClose} radio={radio} />
    </div>
  );
}

export function LoadingFallback() {
  return (
    <p className="py-8 text-center text-muted-foreground text-xs">Loading…</p>
  );
}
