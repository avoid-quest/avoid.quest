# pinterest

Pinterest board and pin scraper.

## Features

- Board data extraction from username
- Pin metadata parsing
- Image URL extraction (multiple resolutions)
- Rate limiting and error handling

## Usage

```typescript
import { PinterestClient } from "@avoid.quest/pinterest";

const client = new PinterestClient();

// Get pins from a user's boards
const pins = await client.getUserPins("username");

// Returns array of pin objects with:
// - id, description, link
// - images (multiple sizes)
// - board info
```

## Connections

- Used by `apps/cwavasape`: Gallery image source
