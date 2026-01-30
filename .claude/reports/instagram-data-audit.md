# Instagram Data Model Audit Report

**Date:** 2025-01-30  
**Test Users:** instagram, cristiano, leomessi  
**Posts Analyzed:** 5 per user (15 total)

---

## Executive Summary

The audit reveals **significant gaps** between Instagram's API response and our current data model. We're missing:
1. **Reel-specific metadata** (music, product_type)
2. **User profile data** (we store username only, not full profile)
3. **Engagement metrics** (likes, comments, views)
4. **Content metadata** (location, tagged users, accessibility captions)
5. **Stories & Highlights** (entirely different endpoints)

---

## Media Types Found

| __typename | Our media_type | Notes |
|------------|----------------|-------|
| `GraphImage` | `image` | ✅ Supported |
| `GraphVideo` | `video` | ⚠️ Missing reel metadata |
| `GraphSidecar` | `carousel` | ✅ Supported |

### Missing Content Types

1. **Reels vs Regular Videos**
   - Instagram differentiates via `product_type: "clips"` (Reels) vs `product_type: "feed"` (regular video)
   - We treat all videos the same - no distinction
   - Reels have `clips_music_attribution_info` with audio/song data

2. **Stories** - Not in `edge_owner_to_timeline_media`
   - Requires separate endpoint: `/api/v1/feed/reels_media/`
   - Available via `highlight_reel_count` (user has 15 highlights)

3. **IGTV/Long-form** - Available via `edge_felix_video_timeline`
   - @instagram has 273 IGTV videos
   - We currently ignore this edge type

---

## Fields We're NOT Capturing

### Post-Level (currently missing)

| Field | Description | Priority |
|-------|-------------|----------|
| `product_type` | "clips" (Reel) vs "feed" (regular) | HIGH |
| `clips_music_attribution_info` | Reel audio/song data | MEDIUM |
| `location` | Geolocation data | LOW |
| `edge_liked_by.count` | Like count | LOW |
| `edge_media_to_comment.count` | Comment count | LOW |
| `video_view_count` | View count for videos | LOW |
| `coauthor_producers` | Collab post partners | MEDIUM |
| `edge_media_to_tagged_user` | Tagged users in post | LOW |
| `accessibility_caption` | Alt text for images | LOW |
| `is_paid_partnership` | Sponsored content flag | LOW |
| `pinned_for_users` | Whether post is pinned | LOW |
| `has_audio` | Whether video has audio | LOW |

### User Profile Data (currently minimal)

We store only:
- `username`
- `profile_url`
- `to_be_scraped`
- `last_scraped_at`

Instagram provides:
- `id` (Instagram user ID)
- `full_name`
- `biography`
- `profile_pic_url` / `profile_pic_url_hd`
- `edge_followed_by.count` (follower count)
- `edge_follow.count` (following count)
- `is_verified`
- `is_business_account`
- `is_professional_account`
- `category_name` (for business/creator accounts)
- `external_url`
- `bio_links`
- `has_clips` (posts Reels?)
- `has_guides`

---

## Edge Types Available (User Profile)

| Edge | Description | We Use? |
|------|-------------|---------|
| `edge_owner_to_timeline_media` | Main feed posts | ✅ YES |
| `edge_felix_video_timeline` | IGTV/Long videos | ❌ NO |
| `edge_saved_media` | Saved posts (requires auth) | ❌ N/A |
| `edge_media_collections` | Collections (requires auth) | ❌ N/A |
| `edge_related_profiles` | Similar accounts | ❌ NO |

---

## Raw Response Structure

### Post Node Fields (all available)

```
__typename
accessibility_caption
clips_music_attribution_info  ← Reel audio
coauthor_producers            ← Collabs
comments_disabled
dash_info                     ← Video streaming manifest
dimensions                    ← We use this
display_url                   ← We use this
edge_liked_by                 ← Like count
edge_media_preview_like
edge_media_to_caption         ← We use this
edge_media_to_comment         ← Comment count
edge_media_to_tagged_user     ← Tagged users
edge_sidecar_to_children      ← We use this (carousel)
fact_check_information
fact_check_overall_rating
felix_profile_grid_crop
gating_info
has_audio
has_upcoming_event
id                            ← We use this
is_video                      ← We use this
like_and_view_counts_disabled
location
media_overlay_info
media_preview
nft_asset_info
owner
pinned_for_users
product_type                  ← "clips" = Reel
profile_grid_thumbnail_fitting_style
sharing_friction_info
shortcode                     ← We use this
taken_at_timestamp            ← We use this
tall_profile_grid_crop
thumbnail_resources           ← We use this
thumbnail_src
thumbnail_tall_src
tracking_token
video_url                     ← We use this
video_view_count
viewer_can_reshare
```

---

## Recommendations

### Priority 1: Distinguish Reels from Regular Videos
- Add `product_type` field to posts table
- Add `is_reel` computed/indexed field
- Store `clips_music_attribution_info` for Reels (optional, for display)

### Priority 2: Enrich User Profiles
- Store `ig_id`, `full_name`, `biography`, `profile_pic_url_hd`
- Store `is_verified`, follower/following counts
- Update on each scrape

### Priority 3: Stories/Highlights (if needed)
- Requires different API endpoint
- Different content lifecycle (24h expiry)
- May need separate table

### Priority 4: Engagement Metrics (optional)
- Like/comment/view counts
- Useful for sorting/filtering
- Changes over time (snapshot vs live)

---

## Questions for Discussion

1. **Do we care about Reels vs regular videos?** (affects filtering/UI)
2. **Should we fetch IGTV separately?** (@instagram has 273)
3. **Stories?** Different endpoint, ephemeral content
4. **Engagement metrics?** Adds complexity (time-varying data)
5. **Collab posts?** Store co-author info?

---

## Files Modified

- Created: `scripts/instagram-audit.ts`
- Created: `scripts/instagram-audit-raw.json`
