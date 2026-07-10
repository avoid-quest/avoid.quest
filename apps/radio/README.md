# radio

PWA internet radio player with advanced audio mixing, effects chain, and MIDI support.

## Features

- **3 Playback Modes**
  - **Multiple**: several stations simultaneously with independent volume/controls
  - **Single**: focused single-station player with crossfade transitions
  - **DJ**: two-deck mixer with crossfader, channel strip, effects chain, CUE monitoring, MIDI control
- **Audio DSP**: custom AudioWorklet processor with real-time effects (7-band EQ, compressor, delay, reverb, distortion, bitcrusher, stereo tool, pitch shift)
- **Platform support**: Bandcamp albums/tracks, SoundCloud playlists/tracks, YouTube playlists/videos, Radio Garden stations
- **External inputs**: device audio input (mic/line-in), local file playback
- **PWA**: installable, service worker, offline shell
- **Persistence**: TanStack DB collections backed by localStorage — radios, settings, playback sessions
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
| `/api/stream-proxy` | Optional generic compatibility fallback for blocked streams |
| `/api/soundcloud-proxy` | Optional SoundCloud CDN compatibility fallback (domain allowlisted) |
| `/api/bandcamp-proxy` | Optional Bandcamp stream compatibility fallback |
| `/api/feedback` | GitHub issue feedback endpoint |
| `/manifest` | PWA web app manifest (dynamic) |
| `/tunnel` | Sentry envelope tunnel |

Server functions (TanStack Start `createServerFn`):

| Function file | Description |
|--------------|-------------|
| `utils/platform.functions.ts` | Last-resort Bandcamp/SoundCloud/Radio Garden resolver |
| `utils/search.functions.ts` | Last-resort Bandcamp and SoundCloud search |
| `utils/radio-garden.functions.ts` | Last-resort Radio Garden search and suggestions |

YouTube search and resolution run in the browser through user-configured
Invidious+Companion or Piped providers. Provider credentials are not supported.
Static audio URLs and M3U/PLS playlists are also resolved in the browser. The
generic stream relay remains a compatibility fallback when a playlist origin
blocks cross-origin reads. Bandcamp, SoundCloud, and Radio Garden can use
user-configured resolver services first. Settings → Relays can disable all
avoid.quest resolver and audio-proxy fallbacks for client/external-service-only
operation.

## Architecture

### State layers

```
┌─────────────────────────────────────────────┐
│  TanStack DB (localStorage)                  │
│  radiosCollection · settingsCollection       │
│  playbackSessionsCollection                  │
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

### Dev (Doppler)

```
GIT_FEEDBACK_GITHUB_TOKEN= # Fine-grained token with Issues read/write
```

Local development reads these through Doppler. Run `bun run secrets:setup` from
the repository root before starting the app. The radio `dev` script uses
`doppler run` to inject secrets into the process environment and starts the
Cloudflare Vite runtime with `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`. Local type
generation and local development do not depend on committed or generated
`.dev.vars`/`.env` files.

### Build-time (Sentry sourcemap upload)

```
VITE_RADIO_SENTRY_DSN # Optional public browser DSN; also used by /tunnel fallback validation
SENTRY_AUTH_TOKEN   # Required for sourcemap upload
SENTRY_ORG          # Sentry organization slug
SENTRY_PROJECT      # Sentry project slug
SENTRY_RELEASE      # Optional: defaults to radio@<version>
```

If any required Sentry build vars are missing, production builds print one
warning and skip the upload step. The app still builds with hidden source maps;
set all three required vars in release/deploy environments to upload them.

### Runtime (Sentry)

```
RADIO_SENTRY_DSN    # Optional server DSN and primary /tunnel validation target
SENTRY_DSN          # Optional fallback server DSN name
```

Local development works without Sentry variables. In that mode client/server
Sentry initialization is skipped and `/tunnel` returns 503 until a DSN is
configured.

## Cloudflare exposure

Committed Wrangler config enables `workers_dev` and `preview_urls` for
workers.dev and Workers Builds preview exposure. Custom production hostnames
should be configured with Cloudflare account-level custom domains or routes
outside this repository.

Workers Builds PR comments should include the branch preview URL after upload.

## Development

```bash
bun run dev          # Start dev server with Doppler (port 3000)
bun run build        # Production build
bun run typecheck    # tsc --noEmit
bun run test         # Run tests (bun test)
bun run cf-deploy    # Deploy to Cloudflare Workers
bun run cf-upload    # Upload new version without promoting
bun run cf-typegen   # Regenerate cloudflare-env.d.ts
```
