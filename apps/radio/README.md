# radio

PWA internet radio player with 3 modes and audio mixing.

## Features

- Multiple mode: grid layout, each station plays independently
- Single mode: one station at a time, smooth transitions, persistent state
- DJ mode: dual deck interface, drag stations to decks, crossfader blending, real-time mixing
- Radio management: add/edit/delete stations, enable/disable, drag reorder, metadata (name/logo/description/url)
- Web scraping wizard: auto-discover stream URL, name, logo, description from website
- Import/export: JSON download, shareable URLs with compressed data, merge/replace config, preview before apply
- Local storage: IndexedDB stores all stations/settings, works offline
- Audio engine: Cacophony for streaming, crossfader, volume control, error handling
- PWA: installable on mobile/desktop

## Connections

- Standalone app: no backend dependencies
- Uses `@workspace/ui`: shared component library
- Deploy: Cloudflare Pages via OpenNext
