// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Radio } from "@/lib/audio";
import { loadSearchSource } from "@/lib/node-source-loaders";
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
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    []
  );
  const invalidate = () => {
    generation.current += 1;
    const { current } = generation;
    setError(null);
    return () => current === generation.current;
  };
  const handleOpenChange = (nextOpen: boolean) => {
    invalidate();
    setOpen(nextOpen);
  };
  const load = async (radio: Radio) => {
    const isCurrent = invalidate();
    try {
      const prepared = await loadSearchSource(radio, {
        isCurrent,
        knownRadios: radios,
      });
      if (!isCurrent()) {
        return;
      }
      if ("error" in prepared) {
        setError(prepared.error);
        return;
      }
      await onLoad(prepared.radio);
      if (isCurrent()) {
        handleOpenChange(false);
      }
    } catch (cause: unknown) {
      if (isCurrent()) {
        setError(
          cause instanceof Error ? cause.message : "Couldn’t add this source"
        );
      }
    }
  };
  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
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
          onLoad={load}
          onSearchChange={invalidate}
          radios={radios}
        />
        {error ? <InlineError>{error}</InlineError> : null}
      </PopoverContent>
    </Popover>
  );
}
