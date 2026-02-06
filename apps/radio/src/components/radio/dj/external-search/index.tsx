import type { SearchPlatform } from "@avoid.quest/platforms";
import { useState } from "react";
import type { Radio } from "@/lib/audio";
import { SearchInput } from "./search-input";
import { SearchResults } from "./search-results";
import { UrlInput } from "./url-input";

type ExternalSearchProps = {
  onLoad: (radio: Radio) => void;
  onCancel?: () => void;
};

export function ExternalSearch({ onLoad, onCancel }: ExternalSearchProps) {
  const [platform, setPlatform] = useState<SearchPlatform>("all");
  const [bandcampFilter, setBandcampFilter] = useState<"" | "t" | "a">("t");
  const [youtubeFilter, setYoutubeFilter] = useState<"songs" | "videos">(
    "songs"
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2">
      <SearchInput
        bandcampFilter={bandcampFilter}
        onBandcampFilterChange={setBandcampFilter}
        onLoad={onLoad}
        onPlatformChange={setPlatform}
        onYoutubeFilterChange={setYoutubeFilter}
        platform={platform}
        youtubeFilter={youtubeFilter}
      />

      <SearchResults onLoad={onLoad} />

      <UrlInput onCancel={onCancel} onLoad={onLoad} />
    </div>
  );
}
