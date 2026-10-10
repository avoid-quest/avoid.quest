// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { prepareSourceRadio } from "@/lib/node-source-loaders";
import { ExternalSearch } from "../dj/external-search";
import { InlineError } from "../inline-error";

export function SourceSearchPopover({
  radios,
  onLoad,
}: {
  radios: Radio[];
  onLoad: (radio: Radio) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async (radio: Radio) => {
    setError(null);
    const prepared = await prepareSourceRadio(radio);
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    await onLoad(prepared.radio);
    setOpen(false);
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className="min-w-0 max-w-md flex-1 justify-start text-muted-foreground"
          size="sm"
          variant="outline"
        >
          <SearchIcon className="size-3.5" />
          Search sources
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex h-[min(70vh,22rem)] w-96 max-w-[calc(100vw-24px)] flex-col"
      >
        <ExternalSearch
          mode="node"
          onLoad={(radio) => {
            load(radio).catch((cause: unknown) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Couldn’t add this source"
              )
            );
          }}
          radios={radios}
        />
        {error ? <InlineError>{error}</InlineError> : null}
      </PopoverContent>
    </Popover>
  );
}
