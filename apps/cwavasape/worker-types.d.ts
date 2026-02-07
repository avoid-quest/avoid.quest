// Augment DOM CacheStorage with Cloudflare Workers' `default` cache property
// See: https://developers.cloudflare.com/workers/runtime-apis/cache/
type CacheStorage = {
  readonly default: Cache;
};
