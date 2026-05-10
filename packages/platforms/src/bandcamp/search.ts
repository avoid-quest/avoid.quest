/**
 * Bandcamp Search API
 *
 * Uses the Bandcamp autocomplete_elastic endpoint to search for tracks and albums.
 */

export type BandcampSearchFilter = "" | "t" | "a" | "b";
// "" = all, "t" = tracks, "a" = albums, "b" = bands/artists

export type BandcampSearchResult = {
  id: string;
  type: "track" | "album" | "artist";
  title: string;
  artist: string;
  thumbnail?: string;
  url: string;
  albumTitle?: string;
};

type BandcampSearchApiResult = {
  type: string;
  id: number;
  name: string;
  band_name?: string;
  item_url_path?: string;
  img?: string;
  album_name?: string;
  art_id?: number;
};

type BandcampSearchApiResponse = {
  auto: {
    results: BandcampSearchApiResult[];
  };
};

const SEARCH_TIMEOUT_MS = 10_000;

/**
 * Convert Bandcamp image data to thumbnail URL
 * The API returns URLs like "https://f4.bcbits.com/img/1234567890_2.jpg" (missing 'a' prefix)
 * Correct format is "https://f4.bcbits.com/img/a1234567890_2.jpg"
 */
function getArtworkUrl(artId?: number, img?: string): string | undefined {
  // If img is a full URL, fix the missing 'a' prefix
  if (img?.startsWith("http")) {
    // URL like https://f4.bcbits.com/img/1234567890_3.jpg -> add 'a' before the ID
    return img.replace("/img/", "/img/a");
  }
  // If img already has 'a' prefix, just add domain
  if (img?.startsWith("a")) {
    return `https://f4.bcbits.com/img/${img}.jpg`;
  }
  // If img is numeric ID like "1234567890_2", add 'a' prefix
  if (img) {
    return `https://f4.bcbits.com/img/a${img}.jpg`;
  }
  // Fall back to art_id
  if (artId) {
    return `https://f4.bcbits.com/img/a${artId}_2.jpg`;
  }
  return;
}

/**
 * Map API type string to our type union
 */
function mapItemType(type: string): "track" | "album" | "artist" {
  if (type === "t") {
    return "track";
  }
  if (type === "a") {
    return "album";
  }
  return "artist";
}

/**
 * Build full Bandcamp URL from item_url_path
 */
function buildUrl(itemUrlPath?: string): string {
  if (!itemUrlPath) {
    return "";
  }
  // item_url_path is like "//artistname.bandcamp.com/album/albumname"
  if (itemUrlPath.startsWith("//")) {
    return `https:${itemUrlPath}`;
  }
  if (itemUrlPath.startsWith("/")) {
    return `https://bandcamp.com${itemUrlPath}`;
  }
  return itemUrlPath;
}

/**
 * Search Bandcamp for tracks, albums, or artists.
 *
 * @param query - Search query string
 * @param filter - Optional filter: "" (all), "t" (tracks), "a" (albums), "b" (bands)
 * @param limit - Maximum results to return (default 20)
 */
export async function searchBandcamp(
  query: string,
  filter: BandcampSearchFilter = "",
  limit = 20
): Promise<BandcampSearchResult[]> {
  const response = await fetch(
    "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      body: JSON.stringify({
        search_text: query,
        search_filter: filter,
        full_page: true,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    throw new Error(`Bandcamp search failed: ${response.statusText}`);
  }

  const data = (await response.json()) as BandcampSearchApiResponse;
  const results = data.auto?.results ?? [];

  return results.slice(0, limit).map((item) => ({
    id: String(item.id),
    type: mapItemType(item.type),
    title: item.name,
    artist: item.band_name || "",
    thumbnail: getArtworkUrl(item.art_id, item.img),
    url: buildUrl(item.item_url_path),
    albumTitle: item.album_name,
  }));
}
