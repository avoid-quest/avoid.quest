import { Input } from "@avoid.quest/ui/components/input";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { cn } from "@avoid.quest/ui/lib/utils";
import { SearchIcon } from "lucide-react";

type SearchFieldProps = Omit<React.ComponentProps<typeof Input>, "type"> & {
  isSearching?: boolean;
};

/** The one search input: icon, compact height, spinner while a search runs. */
export function SearchField({
  className,
  isSearching = false,
  maxLength = 200,
  placeholder = "Search stations…",
  "aria-label": ariaLabel,
  ...props
}: SearchFieldProps) {
  return (
    <div className={cn("relative", className)}>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/50"
      />
      <Input
        aria-label={ariaLabel ?? placeholder.replace("…", "")}
        className={cn(
          "h-8 pl-8 [&::-webkit-search-cancel-button]:opacity-60 [&::-webkit-search-cancel-button]:grayscale",
          isSearching && "pr-8 [&::-webkit-search-cancel-button]:hidden"
        )}
        maxLength={maxLength}
        placeholder={placeholder}
        type="search"
        {...props}
      />
      {isSearching ? (
        <Spinner className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
      ) : null}
    </div>
  );
}
