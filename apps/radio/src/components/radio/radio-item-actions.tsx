import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Copy,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import type { Radio } from "@/lib/types";

type RadioItemActionsProps = {
  radio: Radio;
  onEdit?: (radio: Radio) => void;
  onDelete?: (radio: Radio) => void;
  onToggle?: (radio: Radio, enabled: boolean) => void;
  disabled?: boolean;
};

export function RadioItemActions({
  radio,
  onEdit,
  onDelete,
  onToggle,
  disabled = false,
}: RadioItemActionsProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!radio.id) {
      return;
    }
    if (!onToggle) {
      return;
    }

    setIsUpdating(true);
    try {
      const newEnabled = !radio.enabled;
      await db.radios.update(radio.id, { enabled: newEnabled });
      onToggle(radio, newEnabled);
      toast.success(`${radio.name} ${newEnabled ? "enabled" : "disabled"}`);
    } catch (error) {
      console.error("Failed to toggle radio:", error);
      toast.error("Failed to toggle radio");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(radio);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(radio);
  };

  const handleCopyStreamLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(radio.streamUrl);
      toast.success("Stream link copied to clipboard");
    } catch (error) {
      console.error("Failed to copy stream link:", error);
      toast.error("Failed to copy stream link");
    }
  };

  const handleGoToWebsite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (radio.websiteUrl) {
      window.open(radio.websiteUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-8 w-8 p-0"
          disabled={disabled || isUpdating}
          onClick={(e) => e.stopPropagation()}
          size="sm"
          variant="ghost"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleCopyStreamLink}>
          <Copy className="mr-2 size-4" />
          Copy Stream Link
        </DropdownMenuItem>

        {radio.websiteUrl && (
          <DropdownMenuItem onClick={handleGoToWebsite}>
            <ExternalLink className="mr-2 size-4" />
            Go to Website
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleEdit}>
          <Pencil className="mr-2 size-4" />
          Edit
        </DropdownMenuItem>

        {onToggle && (
          <DropdownMenuItem disabled={isUpdating} onClick={handleToggle}>
            {radio.enabled ? (
              <>
                <ToggleRight className="mr-2 size-4" />
                Disable
              </>
            ) : (
              <>
                <ToggleLeft className="mr-2 size-4" />
                Enable
              </>
            )}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={handleDelete}
        >
          <Trash2 className="mr-2 size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
