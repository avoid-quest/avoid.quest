"use client";

import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { CalendarIcon, SearchIcon, XIcon } from "lucide-react";
import { useFilterState, useHasActiveFilters } from "@/lib/hooks/use-filters";
import { useUsers } from "@/lib/hooks/use-users";
import {
  clearFilters,
  type DatePreset,
  setCustomDateRange,
  setDatePreset,
  setSearch,
  setUserId,
} from "@/lib/stores/filter-store";

const datePresets: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "year", label: "Past year" },
  { value: "custom", label: "Custom range" },
];

export function Filters() {
  const state = useFilterState();
  const hasFilters = useHasActiveFilters();
  const users = useUsers(100);

  const formatDateForInput = (timestamp: number | null) => {
    if (!timestamp) {
      return "";
    }
    return new Date(timestamp).toISOString().split("T")[0];
  };

  const parseDateInput = (dateStr: string): number | null => {
    if (!dateStr) {
      return null;
    }
    return new Date(dateStr).getTime();
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
      {/* Search input */}
      <div className="relative min-w-[200px] flex-1">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search captions..."
          type="search"
          value={state.search}
        />
      </div>

      {/* User filter */}
      <Select
        onValueChange={(value) => setUserId(value === "all" ? null : value)}
        value={state.userId ?? "all"}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All users" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All users</SelectItem>
          {users?.map((user) => (
            <SelectItem key={user._id} value={user._id}>
              @{user.username}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Date preset */}
      <Select
        onValueChange={(value) => setDatePreset(value as DatePreset)}
        value={state.datePreset}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Date range" />
        </SelectTrigger>
        <SelectContent>
          {datePresets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Custom date range popover */}
      {state.datePreset === "custom" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button className="gap-2" size="sm" variant="outline">
              <CalendarIcon className="size-4" />
              {state.startDate && state.endDate
                ? `${new Date(state.startDate).toLocaleDateString()} - ${new Date(state.endDate).toLocaleDateString()}`
                : "Select dates"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label
                  className="font-medium text-sm"
                  htmlFor="filter-start-date"
                >
                  From
                </label>
                <Input
                  id="filter-start-date"
                  onChange={(e) =>
                    setCustomDateRange(
                      parseDateInput(e.target.value),
                      state.endDate
                    )
                  }
                  type="date"
                  value={formatDateForInput(state.startDate)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  className="font-medium text-sm"
                  htmlFor="filter-end-date"
                >
                  To
                </label>
                <Input
                  id="filter-end-date"
                  onChange={(e) =>
                    setCustomDateRange(
                      state.startDate,
                      parseDateInput(e.target.value)
                    )
                  }
                  type="date"
                  value={formatDateForInput(state.endDate)}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Clear filters */}
      {hasFilters && (
        <Button
          className="gap-1"
          onClick={clearFilters}
          size="sm"
          variant="ghost"
        >
          <XIcon className="size-4" />
          Clear
        </Button>
      )}
    </div>
  );
}
