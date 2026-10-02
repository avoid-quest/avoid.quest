// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { copyStreamUrl, openStationWebsite } from "../../radio-item-actions";

type DeckId = "deck-a" | "deck-b";

type DeckMenuProps = {
  deckId: DeckId;
  radio: Radio | null;
  onReset: () => Promise<void>;
  className?: string;
};

/**
 * The deck's options. Desktop shows it in the header row; phones place it in
 * the flow of the deck's first card so it scrolls with the deck.
 */
export function DeckMenu({ deckId, radio, onReset, className }: DeckMenuProps) {
  const label = deckId === "deck-a" ? "A" : "B";

  const handleStopPropagation = (event: React.MouseEvent) => {
    event.stopPropagation();
  };
  const handleCopyStreamLink = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (radio) {
      copyStreamUrl(radio);
    }
  };
  const handleGoToWebsite = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (radio) {
      openStationWebsite(radio);
    }
  };
  const handleReset = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await onReset();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Couldn't reset deck";
      toast.error(message);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Deck ${label} options`}
          className={cn(
            "size-7 shrink-0 [@media(pointer:coarse)]:size-9",
            className
          )}
          disabled={!radio}
          onClick={handleStopPropagation}
          size="icon"
          style={{ visibility: radio ? "visible" : "hidden" }}
          variant="ghost"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      {radio ? (
        <DropdownMenuContent align={deckId === "deck-b" ? "start" : "end"}>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleReset}>
            <RefreshCwIcon />
            Reset effects &amp; channel
          </DropdownMenuItem>
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  );
}

/** Desktop only: the deck letter and its options, above the deck. */
export function DeckHeader({
  deckId,
  radio,
  onReset,
  className,
}: DeckMenuProps) {
  const isRight = deckId === "deck-b";

  return (
    <div
      className={cn(
        "hidden items-center gap-2 px-3 py-1.5 md:flex",
        isRight && "flex-row-reverse",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5",
          isRight && "flex-row-reverse"
        )}
      >
        <span className="font-bold font-mono text-foreground text-xs uppercase tracking-wider">
          {deckId === "deck-a" ? "A" : "B"}
        </span>
        <div className="h-px w-6 bg-border" />
      </div>

      <div className="flex-1" />

      <DeckMenu deckId={deckId} onReset={onReset} radio={radio} />
    </div>
  );
}
