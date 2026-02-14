// Augment DOM CacheStorage with Cloudflare Workers' `default` cache property
// See: https://developers.cloudflare.com/workers/runtime-apis/cache/
declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: interface required for global augmentation
  interface CacheStorage {
    readonly default: Cache;
  }
}

export {};
