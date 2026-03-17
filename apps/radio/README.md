# radio

PWA internet radio player with advanced audio mixing, effects chain, and MIDI support.

## Features

- **3 Playback Modes**
  - **Multiple**: several stations simultaneously with independent volume/controls
  - **Single**: focused single-station player with crossfade transitions
  - **DJ**: two-deck mixer with crossfader, channel strip, effects chain, CUE monitoring, MIDI control
- **Audio DSP**: custom AudioWorklet processor with real-time effects (7-band EQ, compressor, delay, reverb, distortion, bitcrusher, stereo tool, varispeed)
- **Platform support**: Bandcamp albums/tracks, SoundCloud playlists/tracks, YouTube playlists/videos, Radio Garden stations
- **External inputs**: device audio input (mic/line-in), local file playback
- **PWA**: installable, service worker, offline shell
- **Persistence**: TanStack DB collections backed by localStorage — radios, settings, DJ state
- **Visualizations**: spectrum analyser, waveform display, level/peak meters
- **Media Session API**: lock screen controls, AVRCP Bluetooth metadata
- **MIDI**: configurable controller mappings for all DJ actions
- **Import/Export**: JSON config, shareable URL (lz-string compressed)
- **Theme**: dark/light mode

## Tech Stack

- **Routing**: TanStack Start + TanStack Router (file-based, SSR disabled for UI routes)
- **State**: TanStack DB (persisted), TanStack Store (runtime), TanStack Query (platform metadata)
- **Throttling**: `@tanstack/react-pacer` (`useThrottledCallback`)
- **DSP**: `@opendaw/lib-dsp` (biquad filters, compressor, spectrum analyser, DSP primitives)
- **Audio**: Web Audio API, AudioWorklet, HLS.js, HTML5 Audio
- **UI**: React 19, Tailwind CSS v4, shadcn/ui, Radix UI, dnd-kit
- **Deploy**: Cloudflare Workers (Wrangler)
- **Monitoring**: Sentry (client + server, via `/tunnel` route)

## Routes

| Route | Description |
|-------|-------------|
| `/` | Main player — switches between Multiple / Single / DJ mode |
| `/import` | Batch import radios from a URL or JSON |
| `/api/stream-proxy` | CORS proxy for radio streams |
| `/api/soundcloud-proxy` | SoundCloud CDN proxy (domain allowlisted) |
| `/api/bandcamp-proxy` | Bandcamp stream proxy |
| `/manifest` | PWA web app manifest (dynamic) |
| `/tunnel` | Sentry envelope tunnel |

Server functions (TanStack Start `createServerFn`):

| Function file | Description |
|--------------|-------------|
| `utils/platform.functions.ts` | Resolve Bandcamp/SoundCloud/YouTube/Radio Garden URLs |
| `utils/search.functions.ts` | Search Bandcamp and SoundCloud |
| `utils/youtube.functions.ts` | YouTube search + stream URL resolution (Invidious) |
| `utils/radio-garden.functions.ts` | Radio Garden search, stream resolve, suggestions |
| `utils/static-audio.functions.ts` | Static audio file probing and playlist parsing |

## Architecture

### State layers

```
┌─────────────────────────────────────────────┐
│  TanStack DB (localStorage)                  │
│  radiosCollection · settingsCollection       │
│  deckCollection · mixerCollection            │
│  singleStateCollection                       │
├─────────────────────────────────────────────┤
│  TanStack Store (in-memory runtime)          │
│  djRuntimeStore — isPlaying, isLoading,      │
│  soundId, peakLevels, drag state             │
├─────────────────────────────────────────────┤
│  TanStack Query (server state cache)         │
│  platform metadata, search results           │
└─────────────────────────────────────────────┘
```

### Audio signal path (DJ mode)

```
Html5AudioSource / DeviceSource
  → Pan → Filter → WorkletNode (effects chain)
  → PreFaderSend (CUE tap) → Gain (fader)
  → Analyser → MainDelayNode → Destination (speakers)

CueBus: PreFaderSend → CueSumNode → CueDelayNode
  → HeadphoneGain → MediaStreamDest → Headphones (setSinkId)
```

## Environment variables

### Dev (`.dev.vars`)

```
INVIDIOUS_INSTANCE_URL=   # Invidious instance for YouTube stream resolution
INVIDIOUS_AUTH=           # Optional Invidious auth token
```

### Build-time (Sentry sourcemap upload)

```
SENTRY_AUTH_TOKEN   # Required for sourcemap upload
SENTRY_ORG          # Sentry organization slug
SENTRY_PROJECT      # Sentry project slug
SENTRY_RELEASE      # Optional: defaults to radio@<version>
```

If any Sentry build vars are missing the upload step is skipped silently.

## Development

```bash
bun run dev          # Start dev server (port 3000)
bun run build        # Production build
bun run typecheck    # tsc --noEmit
bun run test         # Run tests (bun test)
bun run cf-deploy    # Deploy to Cloudflare Workers
bun run cf-upload    # Upload new version without promoting
bun run cf-typegen   # Regenerate cloudflare-env.d.ts
```
