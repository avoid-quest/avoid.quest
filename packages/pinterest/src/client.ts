import type { PinResponse } from "./types";

export type FetchPinsOptions = {
  username: string;
  bookmark?: string;
  baseUrl?: string;
};

export type PinsPage = {
  pins: PinResponse[];
  nextBookmark: string | null;
};

export class PinterestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "PinterestError";
    this.status = status;
  }
}

/**
 * Fetch pins from a Pinterest user profile.
 * @throws {PinterestError} on API errors
 */
export async function fetchPins(options: FetchPinsOptions): Promise<PinsPage> {
  const { username, bookmark = "", baseUrl = "/api/pinterest" } = options;

  if (!username.trim()) {
    throw new PinterestError("Username is required");
  }

  const params = new URLSearchParams({
    source_url: `/${username}/pins/`,
    data: JSON.stringify({
      options: {
        is_own_profile_pins: false,
        username,
        bookmarks: bookmark ? [bookmark] : [],
      },
    }),
  });

  const response = await fetch(`${baseUrl}?${params}`);

  if (!response.ok) {
    throw new PinterestError(
      `Pinterest API returned ${response.status}`,
      response.status
    );
  }

  const json = await response.json();
  const data = json.resource_response;

  return {
    pins: data.data ?? [],
    nextBookmark: data.bookmark || null,
  };
}
