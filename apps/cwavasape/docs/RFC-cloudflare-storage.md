# RFC: Cloudflare Storage Optimization for cwavasape

## Status: Draft
## Date: 2026-02-01

## Current Architecture

```
User Request → Worker → Pinterest CDN → Response
                     → Pinterest API → Response
```

**Problems:**
1. Every image request fetches from Pinterest CDN (high latency, bandwidth)
2. Pinterest API responses not cached (rate limiting risk)
3. No persistent storage - relies only on browser cache
4. Image transforms happen client-side (PixiJS)

## Cloudflare Storage Options

| Product | Use Case | Pricing (Free Tier) |
|---------|----------|---------------------|
| **R2** | Image/blob storage | 10GB storage, 10M reads, 1M writes/month |
| **KV** | Key-value cache | 100k reads, 1k writes/day |
| **D1** | SQLite database | 5M reads, 100k writes/day |
| **Cache API** | Edge caching | Included with Workers |
| **Images** | Transform/resize | 5k transforms/month |

## Recommended Implementation

### Phase 1: KV for Pinterest API Caching (Quick Win)
**Effort:** 2-3 hours

Cache Pinterest `UserPinsResource` responses in KV:
- Key: `pins:${username}:${bookmark}` 
- Value: JSON response
- TTL: 1 hour (configurable)

```typescript
// Example implementation
const cacheKey = `pins:${username}:${bookmark || 'first'}`;
const cached = await env.PINTEREST_CACHE.get(cacheKey, 'json');

if (cached) {
  return json(cached);
}

const response = await fetch(pinterestUrl, ...);
const data = await response.json();

// Cache for 1 hour
await env.PINTEREST_CACHE.put(cacheKey, JSON.stringify(data), {
  expirationTtl: 3600
});
```

**Benefits:**
- Reduces Pinterest API calls by 90%+
- Faster subsequent page loads
- Protects against rate limiting

**wrangler.jsonc changes:**
```json
{
  "kv_namespaces": [
    { "binding": "PINTEREST_CACHE", "id": "<namespace-id>" }
  ]
}
```

---

### Phase 2: R2 for Image Storage (Medium Effort)
**Effort:** 4-6 hours

Store proxied Pinterest images in R2:

```
Request Flow:
1. Check R2 for image
2. If exists → return from R2 (with Cache API)
3. If not → fetch from Pinterest CDN → store in R2 → return
```

```typescript
// Key format: images/<size>/<hash>.jpg
const imageKey = `images/${size}/${hashUrl(originalUrl)}.jpg`;

// Try R2 first
const cached = await env.IMAGE_BUCKET.get(imageKey);
if (cached) {
  return new Response(cached.body, {
    headers: {
      'Content-Type': cached.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }
  });
}

// Fetch from Pinterest and store
const response = await fetch(originalUrl, ...);
const imageData = await response.arrayBuffer();

await env.IMAGE_BUCKET.put(imageKey, imageData, {
  httpMetadata: { contentType: response.headers.get('Content-Type') }
});

return new Response(imageData, ...);
```

**Benefits:**
- Zero egress fees (vs Pinterest CDN)
- Permanent storage - images never lost
- Faster delivery from Cloudflare edge
- Foundation for image transforms

**wrangler.jsonc changes:**
```json
{
  "r2_buckets": [
    { "binding": "IMAGE_BUCKET", "bucket_name": "cwavasape-images" }
  ]
}
```

---

### Phase 3: Cloudflare Image Resizing (Optional)
**Effort:** 2-3 hours

Use Cloudflare Images to generate size variants on-the-fly:

```typescript
// Transform images from R2
const transformed = await fetch(r2Url, {
  cf: {
    image: {
      width: 474,
      quality: 85,
      format: 'webp'
    }
  }
});
```

**Benefits:**
- Automatic WebP/AVIF conversion
- On-demand size variants
- Reduced storage (store original only)
- Better mobile performance

**Note:** Requires paid plan ($5/month) for > 5k transforms

---

### Phase 4: Cache API for Hot Images (Edge Caching)
**Effort:** 1-2 hours

Add Cache API layer in front of R2:

```typescript
const cache = caches.default;
const cacheKey = new Request(url, request);

// Try cache first
let response = await cache.match(cacheKey);
if (response) {
  return response;
}

// Get from R2
response = await getFromR2(imageKey);

// Cache at edge for 1 day
response = new Response(response.body, {
  headers: {
    ...response.headers,
    'Cache-Control': 'public, max-age=86400'
  }
});
await cache.put(cacheKey, response.clone());

return response;
```

**Benefits:**
- Sub-10ms response for hot images
- Reduces R2 read operations
- Automatic global distribution

---

## Implementation Order

| Phase | Feature | Effort | Impact | Priority |
|-------|---------|--------|--------|----------|
| 1 | KV for API cache | 2-3h | High | 🔴 Do First |
| 2 | R2 for images | 4-6h | Very High | 🟠 Next |
| 3 | Image resizing | 2-3h | Medium | 🟡 Optional |
| 4 | Cache API | 1-2h | Medium | 🟢 Polish |

## Cost Estimate (Free Tier)

With ~1000 daily users, ~50 images/session:
- **KV:** ~50k reads/day (well under 100k limit)
- **R2:** ~50k reads/day, ~500 writes/day (well under limits)
- **Total:** $0/month

At scale (10k+ users), may need:
- Workers Paid ($5/month): More requests, KV, R2
- Images ($5/month): Unlimited transforms

## Questions to Resolve

1. **Image retention:** Keep forever or TTL-based cleanup?
2. **Size variants:** Store all sizes or transform on demand?
3. **User accounts:** Future feature? Would benefit from D1
4. **Analytics:** Track popular images? Analytics Engine?

## Next Steps

1. ✅ Review this RFC
2. Create KV namespace: `wrangler kv namespace create PINTEREST_CACHE`
3. Create R2 bucket: `wrangler r2 bucket create cwavasape-images`
4. Implement Phase 1 (KV caching)
5. Test and deploy
6. Implement Phase 2 (R2 storage)
