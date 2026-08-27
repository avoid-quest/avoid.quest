// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  CopyIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";

type DeckHeaderProps = {
  deckId: "deck-a" | "deck-b";
  radio: Radio | null;
  onReset: () => Promise<void>;
  className?: string;
};

export function DeckHeader({
  deckId,
  radio,
  onReset,
  className,
}: DeckHeaderProps) {
  const label = deckId === "deck-a" ? "A" : "B";
  const isRight = deckId === "deck-b";

  const handleStopPropagation = (event: React.MouseEvent) => {
    event.stopPropagation();
  };
  const handleCopyStreamLink = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!radio) {
      return;
    }
    try {
      await navigator.clipboard.writeText(radio.streamUrl);
      toast.success("Stream link copied to clipboard");
    } catch {
      toast.error("Failed to copy stream link");
    }
  };
  const handleGoToWebsite = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!radio?.websiteUrl) {
      return;
    }
    window.open(radio.websiteUrl, "_blank", "noopener,noreferrer");
  };
  const handleReset = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await onReset();
      toast.success("Deck reset");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reset deck";
      toast.error(message);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5",
        isRight && "flex-row-reverse",
        className
      )}
    >
      {/* Deck label */}
      <div className="flex items-center gap-1.5">
        <span className="font-bold font-mono text-foreground text-xs uppercase tracking-[0.2em]">
          {label}
        </span>
        <div className="h-px w-6 bg-border" />
      </div>

      <div className="flex-1" />

      {/* Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="h-6 w-6 p-0"
            disabled={!radio}
            onClick={handleStopPropagation}
            size="sm"
            style={{ visibility: radio ? "visible" : "hidden" }}
            variant="ghost"
          >
            <MoreHorizontalIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        {radio ? (
          <DropdownMenuContent align={isRight ? "start" : "end"}>
            <DropdownMenuItem onClick={handleCopyStreamLink}>
              <CopyIcon className="mr-2 size-3.5" />
              Copy Stream Link
            </DropdownMenuItem>
            {radio.websiteUrl?.trim() !== "" && (
              <DropdownMenuItem onClick={handleGoToWebsite}>
                <ExternalLinkIcon className="mr-2 size-3.5" />
                Go to Website
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleReset}>
              <RefreshCwIcon className="mr-2 size-3.5" />
              Reset Deck
            </DropdownMenuItem>
          </DropdownMenuContent>
        ) : null}
      </DropdownMenu>
    </div>
  );
}
