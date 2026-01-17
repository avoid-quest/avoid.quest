# radio

PWA internet radio player with advanced audio mixing and 3 playback modes.

## Features

- **3 Playback Modes**:
  - Multiple: play several radios simultaneously with independent volume mixing
  - Single: single station with full controls
  - DJ: advanced mixing with crossfades and effects
- Audio DSP: Web Audio API with AudioWorklet for effects (EQ, compression, etc.)
- Platform imports: Bandcamp and SoundCloud track/playlist support
- PWA: installable, service worker, offline-capable
- Local storage sync: TanStack DB with lz-string compression
- Visualizations: spectrum analysis, waveform display
- Device controls: media keys, hardware button support
- Settings: form-based radio management, import/export data
- Theme: dark/light mode

## Tech Stack

- TanStack Router (file-based routing)
- TanStack React Query, DB, Store
- React 19, TypeScript, Vite
- Tailwind CSS v4
- Cloudflare Workers (deploy)
- @opendaw/lib-dsp for audio processing

## Routes

- `/` - Main radio player (switches between modes)
- `/import` - Import radios from external sources

## Connections

- Uses `@avoid.quest/bandcamp`: Bandcamp metadata extraction
- Uses `@avoid.quest/soundcloud`: SoundCloud metadata extraction
- Uses `@workspace/ui`: form inputs, dialogs, sliders, buttons
