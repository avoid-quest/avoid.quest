# RFC: Cloudflare KV Caching for cwavasape

## Status: Implemented
## Date: 2026-02-01

## Overview

Implement KV caching for Pinterest API responses and image proxying to reduce latency and external API calls.

## Implementation

### KV Namespace

Binding: `CACHE`  
Usage: Caching Pinterest API responses and proxied images

### Pinterest API Caching (`/api/pinterest`)

**Cache key format:** `pinterest:<username>:<bookmark_hash>`  
**TTL:** 1 hour (3600 seconds)

Benefits:
- Reduces Pinterest API calls by 90%+
- Faster subsequent page loads
- Protects against rate limiting

### Image Proxy Caching (`/api/image-proxy`)

**Cache key format:** `img:<size>:<path_hash>`  
**TTL:** 7 days (604800 seconds)  
**Max size:** 20MB per image (KV limit is 25MB)

Benefits:
- Reduces Pinterest CDN bandwidth
- Faster image delivery from edge
- Response headers indicate cache status (`X-Cache: HIT/MISS`)

## Setup Instructions

### 1. Create KV Namespace

```bash
cd apps/cwavasape
wrangler kv namespace create CACHE
# Note the namespace ID from output
```

### 2. Update wrangler.jsonc

Replace `TO_BE_CREATED` with the actual namespace ID:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "<your-namespace-id>"
    }
  ]
}
```

### 3. For Local Development (optional)

Create a preview namespace:

```bash
wrangler kv namespace create CACHE --preview
```

Add to wrangler.jsonc:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "<production-id>",
      "preview_id": "<preview-id>"
    }
  ]
}
```

## Graceful Degradation

Both caching implementations use optional chaining (`env.CACHE?.get/put`) and try/catch blocks, so:
- Development without KV binding works normally (no caching)
- KV write failures don't break the request flow
- KV read failures fall back to origin fetch

## Free Tier Limits

| Resource | Limit | Expected Usage |
|----------|-------|----------------|
| KV Reads | 100,000/day | ~50,000/day (well under) |
| KV Writes | 1,000/day | ~500/day (well under) |
| KV Storage | 1 GB | ~100MB (images + API responses) |

## Future Improvements

1. **Cache warming:** Preload popular users' pins on first visit
2. **Cache invalidation:** Add manual purge endpoint for stale data
3. **Analytics:** Track cache hit rates for optimization
