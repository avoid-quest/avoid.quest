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

/** Shared by every station menu so the copy action and its toast read the same. */
export async function copyStreamUrl(radio: Radio) {
  try {
    await navigator.clipboard.writeText(radio.streamUrl);
    toast.success("Stream URL copied");
  } catch {
    toast.error("Couldn't copy stream URL");
  }
}

export function openStationWebsite(radio: Radio) {
  if (radio.websiteUrl?.trim()) {
    window.open(radio.websiteUrl, "_blank", "noopener,noreferrer");
  }
}

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

  const handleCopyStreamLink = (event: React.MouseEvent) => {
    event.stopPropagation();
    copyStreamUrl(radio);
  };

  const handleGoToWebsite = (event: React.MouseEvent) => {
    event.stopPropagation();
    openStationWebsite(radio);
  };
  const handleStopPropagation = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Options for ${radio.name}`}
          className="size-7"
          disabled={disabled || isUpdating}
          onClick={handleStopPropagation}
          size="icon"
          variant="ghost"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isSession && onSave ? (
          <>
            <DropdownMenuItem onClick={handleSave}>
              <BookmarkPlusIcon />
              Save
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuItem onClick={handleCopyStreamLink}>
          <CopyIcon />
          Copy stream URL
        </DropdownMenuItem>

        {Boolean(radio.websiteUrl?.trim()) && (
          <DropdownMenuItem onClick={handleGoToWebsite}>
            <ExternalLinkIcon />
            Website
          </DropdownMenuItem>
        )}

        {!isSession && (
          <>
            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleEdit}>
              <PencilIcon />
              Edit
            </DropdownMenuItem>

            {onToggle ? (
              <DropdownMenuItem disabled={isUpdating} onClick={handleToggle}>
                {radio.enabled ? (
                  <>
                    <ToggleRightIcon />
                    Hide
                  </>
                ) : (
                  <>
                    <ToggleLeftIcon />
                    Show
                  </>
                )}
              </DropdownMenuItem>
            ) : null}
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleDelete} variant="destructive">
          {isSession ? (
            <>
              <XIcon />
              Remove
            </>
          ) : (
            <>
              <Trash2Icon />
              Delete
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
