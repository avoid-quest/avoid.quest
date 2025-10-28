# Radio Proxy

A Progressive Web App for internet radio with three player modes and advanced audio mixing.

## Tech Stack

- **Next.js 15.5.4** - React framework
- **React 19.2.0** - UI library
- **TypeScript 5.9.3** - Type safety
- **Tailwind CSS 4.1.14** - Styling
- **Shadcn/ui** - UI components (Radix UI primitives)
- **Dexie 4.2.1** - IndexedDB database
- **Cacophony 0.15.3** - Audio engine for mixing
- **Cloudflare Workers** - Deployment
- **PWA** - Installable web app

## Development

### Requirements

- Node.js 22.16.0+
- pnpm 10.18.2+

### Commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Build
pnpm run fix          # Format and Lint
```

## Player Modes

### Multiple Mode

- Grid layout of radio stations
- Each station plays independently
- Individual controls per station
- Switch between player types (custom react component or html audio element)

### Single Mode

- One radio station at a time
- Smooth transitions between stations
- Volume control and mute
- Persistent radio state (last used radio on reload)

### DJ Mode

- Dual deck interface (left/right)
- Drag radio stations to decks
- Crossfader to blend between decks
- Individual volume per deck
- Real-time audio mixing

## Settings

### Player Settings

- Separate settings for Multiple/Single/DJ modes
- Set transition duration for Single mode
- Choose custom player or browser default player (custom react component or html audio element)

### Radio Management

- Add/edit/delete radio stations
- Enable/disable stations
- Reorder stations by dragging
- Set station metadata (name, logo, description, etc)

## Import/Export

### Export

- Possibility to download configuration as JSON file
- Possibility to generate shareable URLs with compressed data
- Possibility to backup all settings and radio stations

### Import

- Upload JSON configuration files or navigate to a shareable URL
- Possibility to merge new stations with existing ones
- Possibility to replace entire configuration
- Preview changes before applying

## Radio Station Features

### Manual Addition

- Enter station name, stream URL (with preview), logo URL (with preview)
- Add description and website URL
- Set custom order

### Guided Addition (Web Scraping Wizard)

- Enter radio station website URL
- Auto-discover stream URL, name, logo, description (with previews)
- Multiple suggestions with confidence scores
- Choose best options from detected metadata

## Audio Engine

Uses [Cacophony](https://cacophony.js.org/) for advanced audio processing:

- **Streaming Support**: Direct audio stream playback
- **Real-time Mixing**: Crossfader and volume control
- **Effects**: Filters, Reverb, Delay, etc (future features)
- **Error Handling**: Graceful fallback for failed streams
- many more features to come...

### Cacophony Documentation

- [Official Docs](https://cacophony.js.org/)
- [GitHub README](https://raw.githubusercontent.com/ctoth/cacophony/refs/heads/master/README.md)

## Key Features

- **PWA**: Install on mobile/desktop, offline capable
- **Local Storage**: All data stored in browser (IndexedDB)
- **Real-time Audio**: Enhance audio streaming
- **Drag & Drop**: Reorder stations and assign them to DJ decks
- **Theme Support**: Dark/light mode
- **Responsive**: Works on all device sizes
