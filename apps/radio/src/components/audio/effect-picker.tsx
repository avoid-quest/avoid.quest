/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Card } from "@avoid.quest/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import { cn } from "@avoid.quest/ui/lib/utils";
import { FilterIcon, type LucideIcon } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useState } from "react";
import { SearchField } from "@/components/radio/search-field";
import { AVAILABLE_EFFECTS, type EffectType } from "@/lib/audio";
import { isEffectContainerType } from "@/lib/audio/dsp/routing/effect-tree";
import { EFFECT_ICONS } from "./effect-constants";

/** One card in a picker: an effect here, a node in the Node palette. */
export type PickerItem = {
  id: string;
  name: string;
  description?: string;
  /** A small sans tag under the name, e.g. the effect family. */
  badge?: string;
  icon: LucideIcon;
};

export type PickerSection<TItem extends PickerItem> = {
  /** Shown above the section's cards; omit for a single list. */
  title?: string;
  items: readonly TItem[];
};

function PickerOption<TItem extends PickerItem>({
  item,
  onSelect,
}: {
  item: TItem;
  onSelect: (item: TItem) => void;
}) {
  function selectItemWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(item);
    }
  }
  const Icon = item.icon;

  return (
    <Card
      className="cursor-pointer flex-row items-start gap-3 rounded-md border-border/50 p-3 shadow-none outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={() => onSelect(item)}
      onKeyDown={selectItemWithKeyboard}
      role="button"
      tabIndex={0}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-sm leading-tight">
          {item.name}
        </h3>
        {item.badge ? (
          <span className="mt-1 inline-flex rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
            {item.badge}
          </span>
        ) : null}
        {item.description ? (
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            {item.description}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function matches(item: PickerItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.description?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * The picker body: a search field over sections of cards. Typing filters by
 * name and description, and Enter picks the first match.
 */
export function PickerList<TItem extends PickerItem>({
  sections,
  onSelect,
  placeholder,
  emptyText,
  className,
}: {
  sections: readonly PickerSection<TItem>[];
  onSelect: (item: TItem) => void;
  placeholder: string;
  emptyText: string;
  className?: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  function updateSearchQuery(event: ChangeEvent<HTMLInputElement>) {
    setSearchQuery(event.target.value);
  }

  const filtered = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => matches(item, searchQuery)),
    }))
    .filter((section) => section.items.length > 0);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const first = filtered[0]?.items[0];
    if (event.key === "Enter" && first) {
      event.preventDefault();
      onSelect(first);
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      <SearchField
        autoFocus
        onChange={updateSearchQuery}
        onKeyDown={handleSearchKeyDown}
        placeholder={placeholder}
        value={searchQuery}
      />

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-xs">
          {emptyText}
        </p>
      ) : (
        <div className="max-h-128 space-y-4 overflow-y-auto pr-1">
          {filtered.map((section) => (
            <section
              aria-label={section.title}
              className="space-y-2"
              key={section.title ?? "items"}
            >
              {section.title ? (
                <h3 className="font-medium text-muted-foreground text-xs">
                  {section.title}
                </h3>
              ) : null}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {section.items.map((item) => (
                  <PickerOption item={item} key={item.id} onSelect={onSelect} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type EffectPickerProps = {
  onSelect: (effectType: EffectType) => void;
  onClose: () => void;
  allowContainers?: boolean;
};

type EffectItem = PickerItem & { type: EffectType };

export function EffectPicker({
  onSelect,
  onClose,
  allowContainers = true,
}: EffectPickerProps) {
  const effects: EffectItem[] = AVAILABLE_EFFECTS.filter(
    (effect) => allowContainers || !isEffectContainerType(effect.type)
  ).map((effect) => ({
    badge: effect.family,
    description: effect.description,
    icon: EFFECT_ICONS[effect.type] ?? FilterIcon,
    id: effect.type,
    name: effect.name,
    type: effect.type,
  }));

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add effect</DialogTitle>
          <DialogDescription>
            Type to search. Enter adds the first match.
          </DialogDescription>
        </DialogHeader>

        <PickerList
          emptyText="No effects found. Try a different search term."
          onSelect={(effect) => onSelect(effect.type)}
          placeholder="Search effects…"
          sections={[{ items: effects }]}
        />
      </DialogContent>
    </Dialog>
  );
}
