# bandcamp

Bandcamp metadata scraper. Extracts track/album info and stream URLs.

## Features

- Item type detection: track vs album
- HTML parsing with Cheerio
- JSON-LD + data-tralbum extraction
- Stream URL extraction (mp3-128)
- Track metadata: title, artist, duration, track number
- Album metadata: track list, total duration, artwork

## Usage

```typescript
import { getBandcampItem } from "@avoid.quest/bandcamp";

const result = await getBandcampItem("https://artist.bandcamp.com/track/song");

// Returns:
// {
//   success: boolean,
//   metadata: {
//     platform: "bandcamp",
//     itemType: "track" | "album",
//     url, name, artist, artwork, duration,
//     tracks?: [...],
//     streamUrl
//   },
//   streamUrl
// }
```

## Connections

- Used by `apps/radio`: importing Bandcamp tracks/albums as radios
