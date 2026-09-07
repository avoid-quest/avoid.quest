# radio

PWA internet radio player with advanced audio mixing, effects chain, and MIDI support.

## Features

- **3 Playback Modes**
  - **Multiple**: several stations simultaneously with independent volume/controls
  - **Single**: focused single-station player with crossfade transitions
  - **DJ**: two-deck mixer with crossfader, channel strip, effects chain, CUE monitoring, MIDI control
- **Audio DSP**: custom AudioWorklet processor with real-time effects (7-band EQ, compressor, delay, reverb, distortion, bitcrusher, stereo tool, pitch shift)
- **Platform support**: Bandcamp albums/tracks, SoundCloud playlists/tracks, YouTube playlists/videos, and Radio Browser/Radio Garden stations
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
| `/api/feedback` | GitHub issue feedback endpoint |
| `/api/radio-metadata` | Metadata lookup for configured radio streams |
| `/manifest` | PWA web app manifest (dynamic) |
| `/tunnel` | Sentry envelope tunnel |

Server functions (TanStack Start `createServerFn`):

| Function file | Description |
|--------------|-------------|
| `utils/platform.functions.ts` | Bandcamp, SoundCloud, and Radio Garden metadata/URL resolution |
| `utils/search.functions.ts` | Bandcamp and SoundCloud search |
| `utils/radio-garden.functions.ts` | Radio Garden search and suggestions |
| `utils/radio-browser.functions.ts` | Shared Radio Browser directory search |

Audio bytes never pass through the app server. Static audio URLs and M3U/PLS
playlists are resolved directly in the browser. Bandcamp's fresh, validated
`bcbits.com` media URLs use the curated, release-tested public relay pool
`seep.eu.org`,
`proxy.cors.sh`, then `cors.zme.ink`; the browser range-probes the pool under one
deadline before selecting the highest-priority working relay. YouTube tries the
curated, release-tested providers `pipedapi.wireway.ch`, `yt.omada.cafe`,
`invidious.nikkosphere.com`, then `y.com.sb`, with per-provider and whole-pool
deadlines. See `BANDCAMP_RELAY_RESEARCH.md` and
`YOUTUBE_PROVIDER_RESEARCH.md` for the release probes and caveats.

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

### Development (optional)

```
GIT_FEEDBACK_GITHUB_TOKEN= # Fine-grained token with Issues read/write
```

No secret manager or custom variable is required to start the radio app. Set
`GIT_FEEDBACK_GITHUB_TOKEN` through the standard Cloudflare local environment
only when exercising feedback submission locally.

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

### Shared radio metadata

The radio Worker uses Cloudflare's Cache API for disposable metadata. It makes
no Workers KV reads or writes. Live snapshots expire after 60 seconds;
episode/show enrichment after six hours; Radio Garden station attributes after
24 hours; and Radio Browser/Radio Garden searches after ten minutes. NTS
channels reuse one live feed. Fields returned in a live feed retain its
60-second lifetime, including artwork and station details.

Cache hits preserve the original `sampledAt` and `expiresAt`. A named cache
isolates metadata from normal HTTP responses, and keys include the request
origin plus a hash of all provider arguments. Cache entries are local to each
Cloudflare data center and may be evicted before expiry. Concurrent misses can
repeat provider calls. Each cache read or write waits at most 500 ms before
continuing without the cache result. Provider failures and incomplete enrichment
are not stored as successful results. The existing local now-playing cache and
in-flight deduplication remain, capped by the snapshot's expiry.

Episode enrichment stores descriptive fields. Radio Garden resolves playback
URLs on each request, outside the station cache. Radio Browser caches search
descriptions and validated query-free playback URLs. Query-bearing URLs stay
outside the shared cache and are refreshed together by station UUID on cache
hits. Browser playback probes and player state stay local.

Workers KV's free allowance is 100,000 reads and 1,000 writes per day, with
separate limits of 1,000 deletes and lists. One live key rewritten every minute
would need 1,440 writes per day. Bulk operations still count each key, and KV's
`cacheTtl` improves read latency without eliminating KV operations. The radio
Worker therefore has no KV binding. The old namespace is not deleted by this
change; its existing entries expire without explicit delete operations.

Cache API storage does not replicate between data centers, so provider traffic
can increase compared with KV. Worker request and CPU limits still apply, and
other Workers may still consume the account's KV allowance. Cache operations
are ineffective in dashboard/Playground previews and unavailable behind
Cloudflare Access. Verify production cache behavior after deployment.

References: [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/),
[KV reads and cacheTtl](https://developers.cloudflare.com/kv/api/read-key-value-pairs/),
[Cache API behavior and limitations](https://developers.cloudflare.com/workers/runtime-apis/cache/),
and [Radio Browser's provider requirements](https://api.radio-browser.info/).

## Development

```bash
bun run dev          # Start dev server (port 3000)
bun run build        # Production build
bun run typecheck    # tsc --noEmit
bun run test         # Run tests (bun test)
bun run cf-build     # Build the Cloudflare Worker
bun run cf-deploy    # Build and deploy to Cloudflare Workers
bun run cf-upload    # Build and upload a version without promoting
bun run cf-typegen   # Regenerate cloudflare-env.d.ts
```
