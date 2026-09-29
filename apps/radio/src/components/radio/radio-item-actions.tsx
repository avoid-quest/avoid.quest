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
      const id = String(radio.id);
      updateRadio(id, { enabled: newEnabled });
      onToggle(radio, newEnabled);
      toast.success(
        newEnabled ? `Showing "${radio.name}"` : `Hid "${radio.name}"`,
        {
          action: {
            label: "Undo",
            onClick: () => {
              updateRadio(id, { enabled: !newEnabled });
              onToggle(radio, !newEnabled);
            },
          },
        }
      );
    } catch {
      toast.error("Couldn't update station");
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
          aria-label={`Options for ${radio.name}`}
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
              <BookmarkPlusIcon className="size-4" />
              Save
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuItem onClick={handleCopyStreamLink}>
          <CopyIcon className="size-4" />
          Copy stream URL
        </DropdownMenuItem>

        {Boolean(radio.websiteUrl?.trim()) && (
          <DropdownMenuItem onClick={handleGoToWebsite}>
            <ExternalLinkIcon className="size-4" />
            Website
          </DropdownMenuItem>
        )}

        {!isSession && (
          <>
            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleEdit}>
              <PencilIcon className="size-4" />
              Edit
            </DropdownMenuItem>

            {onToggle ? (
              <DropdownMenuItem disabled={isUpdating} onClick={handleToggle}>
                {radio.enabled ? (
                  <>
                    <ToggleRightIcon className="size-4" />
                    Hide
                  </>
                ) : (
                  <>
                    <ToggleLeftIcon className="size-4" />
                    Show
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
              <XIcon className="size-4" />
              Remove
            </>
          ) : (
            <>
              <Trash2Icon className="size-4" />
              Delete
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
