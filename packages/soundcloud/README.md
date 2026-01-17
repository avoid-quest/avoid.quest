# soundcloud

SoundCloud metadata scraper. Extracts track/playlist info and stream URLs.

## Features

- Item type detection: track vs playlist
- SoundCloud API v2 integration
- Dynamic client ID fetching
- URL resolution to item data
- Progressive stream URL extraction
- Playlist processing with error recovery
- CORS proxy support via `/api/soundcloud-proxy`

## Usage

```typescript
import { getSoundCloudItem } from "@avoid.quest/soundcloud";

const result = await getSoundCloudItem("https://soundcloud.com/artist/track");

// Returns:
// {
//   success: boolean,
//   metadata: {
//     platform: "soundcloud",
//     itemType: "track" | "playlist",
//     url, name, artist, artwork, duration,
//     tracks?: [...],
//     streamUrl
//   },
//   streamUrl
// }
```

## Connections

- Used by `apps/radio`: importing SoundCloud tracks/playlists as radios
