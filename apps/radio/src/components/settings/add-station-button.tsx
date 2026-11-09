import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { IconPlus } from "@tabler/icons-react";
import { SettingsButton } from "./settings-button";

/** Open the station page without mounting Settings until it is needed. */
export function AddStationButton({
  iconOnly = false,
  className,
}: {
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <SettingsButton
      defaultTab="add-station"
      trigger={
        <Button
          aria-label="Add station"
          className={cn(
            "pointer-events-auto shrink-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
            className
          )}
          size={iconOnly ? "icon" : "sm"}
          type="button"
          variant="outline"
        >
          <IconPlus aria-hidden="true" />
          {iconOnly ? null : "Add station"}
        </Button>
      }
    />
  );
}
