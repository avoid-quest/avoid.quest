/**
 * Storybook's stand-in for every `@/utils/*.functions` module. Those are
 * TanStack Start server functions that run on the Worker; Storybook has no
 * Worker, so each call fails the way an offline request would, without
 * touching the network. Storybook's Vite config swaps it in.
 */
function unavailable(): Promise<never> {
  return Promise.reject(
    new Error("Server functions are not available in Storybook")
  );
}

export const bandcampSearch = unavailable;
export const loadPlatformItem = unavailable;
export const loadSpotifyMetadata = unavailable;
export const mixcloudSearch = unavailable;
export const radioBrowserSearch = unavailable;
export const radioGardenSearch = unavailable;
export const radioGardenStream = unavailable;
export const soundcloudSearch = unavailable;
