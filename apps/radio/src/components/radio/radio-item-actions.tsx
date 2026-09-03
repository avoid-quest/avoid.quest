/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import {
  BookmarkPlusIcon,
  CopyIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { updateRadio } from "@/lib/hooks/use-radios";
import { isSessionRadio } from "@/lib/hooks/use-session-radios";

type RadioItemActionsProps = {
  radio: Radio;
  onEdit?: (radio: Radio) => void;
  onDelete?: (radio: Radio) => void;
  onToggle?: (radio: Radio, enabled: boolean) => void;
  onSave?: (radio: Radio) => void;
  disabled?: boolean;
};

export function RadioItemActions({
  radio,
  onEdit,
  onDelete,
  onToggle,
  onSave,
  disabled = false,
}: RadioItemActionsProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const isSession = isSessionRadio(radio);

  const handleToggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!radio.id) {
      return;
    }
    if (!onToggle) {
      return;
    }

    setIsUpdating(true);
    try {
      const newEnabled = !radio.enabled;
      updateRadio(String(radio.id), { enabled: newEnabled });
      onToggle(radio, newEnabled);
      toast.success(`${radio.name} ${newEnabled ? "enabled" : "disabled"}`);
    } catch {
      toast.error("Failed to toggle radio");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    onDelete?.(radio);
  };

  const handleEdit = (event: React.MouseEvent) => {
    event.stopPropagation();
    onEdit?.(radio);
  };

  const handleSave = (event: React.MouseEvent) => {
    event.stopPropagation();
    onSave?.(radio);
  };

  const handleCopyStreamLink = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(radio.streamUrl);
      toast.success("Stream link copied to clipboard");
    } catch {
      toast.error("Failed to copy stream link");
    }
  };

  const handleGoToWebsite = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (radio.websiteUrl) {
      window.open(radio.websiteUrl, "_blank", "noopener,noreferrer");
    }
  };
  const handleStopPropagation = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-8 w-8 p-0"
          disabled={disabled || isUpdating}
          onClick={handleStopPropagation}
          size="sm"
          variant="ghost"
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isSession && onSave ? (
          <>
            <DropdownMenuItem onClick={handleSave}>
              <BookmarkPlusIcon className="mr-2 size-4" />
              Save to Collection
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuItem onClick={handleCopyStreamLink}>
          <CopyIcon className="mr-2 size-4" />
          Copy Stream Link
        </DropdownMenuItem>

        {radio.websiteUrl?.trim() !== "" && (
          <DropdownMenuItem onClick={handleGoToWebsite}>
            <ExternalLinkIcon className="mr-2 size-4" />
            Go to Website
          </DropdownMenuItem>
        )}

        {!isSession && (
          <>
            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleEdit}>
              <PencilIcon className="mr-2 size-4" />
              Edit
            </DropdownMenuItem>

            {onToggle ? (
              <DropdownMenuItem disabled={isUpdating} onClick={handleToggle}>
                {radio.enabled ? (
                  <>
                    <ToggleRightIcon className="mr-2 size-4" />
                    Disable
                  </>
                ) : (
                  <>
                    <ToggleLeftIcon className="mr-2 size-4" />
                    Enable
                  </>
                )}
              </DropdownMenuItem>
            ) : null}
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={handleDelete}
        >
          {isSession ? (
            <>
              <XIcon className="mr-2 size-4" />
              Remove
            </>
          ) : (
            <>
              <Trash2Icon className="mr-2 size-4" />
              Delete
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
