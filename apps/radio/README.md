# radio

PWA internet radio player with advanced audio mixing, effects chain, and MIDI support.

## Features

- **3 Playback Modes**
  - **Single**: focused single-station player with crossfade transitions
  - **Node**: a patch canvas (React Flow) where Station nodes are cabled into a Speakers node with Play all and master volume; `/` opens the node palette, and edits are undoable. On phones the Stage and Rack tabs list every source with play and volume. Node replaced Multiple: a stored Multiple session, mode or backup becomes a Node patch with the same stations, order and levels
  - **DJ**: two-deck mixer with crossfader, channel strip, effects chain, CUE monitoring, MIDI control
- **Audio DSP**: custom AudioWorklet processor with real-time effects (7-band EQ, compressor, delay, reverb, distortion, bitcrusher, stereo tool, pitch shift)
- **Platform support**: Bandcamp albums/tracks, SoundCloud playlists/tracks, YouTube playlists/videos, and Radio Browser/Radio Garden stations
- **External inputs**: device audio input (mic/line-in), local files and folder playlists, shared browser/computer audio in Node and DJ
- **PWA**: installable, service worker, offline shell
- **Persistence**: TanStack DB collections backed by localStorage — radios, settings, playback sessions
- **Visualizations**: spectrum analyser, waveform display, level/peak meters
- **Media Session API**: lock screen controls, AVRCP Bluetooth metadata
- **MIDI**: configurable controller mappings for all DJ actions
- **Import/Export**: JSON config, shareable URL (lz-string compressed)
- **Theme**: dark/light mode

## Local folders and shared audio

In Node, add **File**; in DJ, choose **Audio file**. **Browse folder** imports
playable files from every subfolder into a playlist in natural filename order.
Unsupported files are skipped. Enable autoplay to continue through the list;
DJ enables it when loading a folder. Files stay on the device and must be picked
again after a reload.

Both modes offer **Spotify**, **Mixcloud**, **Radio episodes / shows** and
**Browser / computer audio**. Open the source in another tab, play it there,
then use **Go live** (Node) or **Share tab / computer audio** (DJ) and enable
**Share tab audio** in the browser picker. Pasted Spotify, Mixcloud and supported
station archive links load the same shared-audio source; direct audio-file and
playlist URLs retain the normal seekable player. Tracks, shows and seeking are
controlled in the source tab. Sharing is never restored automatically.

This uses the browser's `getDisplayMedia`, with desktop Chrome/Edge recommended.
Window/system audio support varies by browser and OS; a virtual audio input is
another option for desktop software. Protected playback may be silent. Only the
selected stream's audio reaches the mixer; the picker requires a video track,
but the app does not render, record or upload it. Use headphones when sharing
system audio to avoid feeding the mixer back into itself.

Spotify does not expose a supported DJ mixing integration: its
[developer policy](https://developer.spotify.com/policy) prohibits mixing Spotify
content through its platform. These entries use user-selected browser sharing,
with no Spotify SDK or direct media extraction. See Chrome's
[screen-sharing controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls)
for browser capture capabilities.

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
| `/` | Main player — switches between Single / Node / DJ mode |
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

When changing Node Mode graph rules, playback, persistence or editing, read the
[current v1 contract and source map](src/components/radio/NODE_MODE_PROPOSAL.md).
It links to historical design and future roadmap material only when those are needed.

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

External players can request `GET /api/radio-metadata?stationId=<id>` using an
ID from `/playlist.m3u` or `/api/stations.json`. The Worker resolves the current
stream and metadata configuration from the same default station list as those
exports. When `stationId` is supplied, caller `url`, `kind`, and provider-specific
parameters do not override it. Unknown or disabled IDs return HTTP 404 with
`ok: false`; stations without a metadata source return the existing unsupported
response. The configured `url` and `kind` lookup remains supported for the radio
app's editable stations.

Both forms use the same retrieval and cache. Success returns `{ ok: true, data, refreshAfterMs }`
with the existing `RadioNowPlaying` fields, including `streamUrl`, nullable
`title`/`artworkUrl`, `sampledAt`, and `expiresAt`. `refreshAfterMs` is the
remaining snapshot lifetime calculated when the Worker sends the response.
Clients must match `streamUrl` to their playing catalog entry and discard
expired snapshots. Keep the service's
anonymous session cookie on the requesting client and honor HTTP 429 retries.
The existing session, rate-limit, URL validation and origin policies apply.
When renaming a default station, give it an explicit `id` retaining its previous
exported identity, whose value follows the `avoid-radio-` prefix.

The radio Worker stores expiring metadata in Cloudflare's Cache API. It no
longer uses Workers KV. Live snapshots expire within 15 minutes; episode/show
enrichment after six hours; Radio Garden station attributes after 24 hours;
and Radio Browser/Radio Garden searches after ten minutes. NTS channels reuse
one live feed and select its current or future slot at read time. Airtime, LYL,
NTS, and HKCR snapshots expire at the known track or show end when sooner;
Radio Alhara checks at least every five minutes and at its predicted track end.
Separate enrichment caches
cover Sygma, Cashmere, IPR, LYL, HKCR, and BlackOut. HKCR keeps its live/replay
schedule separate from show details. BlackOut stores the verified full
description and genres separately from its listening feed. Upstream response
headers and cookies are not copied into these cached metadata entries.

Unscheduled changes can lag the snapshot lifetime, up to 15 minutes for most
sources. Playing stations request metadata when `refreshAfterMs` elapses,
instead of every 30 seconds. At a full 15-minute lifetime this reduces one
listener's metadata requests from 120 to about four per hour. Expired snapshots
retry after at least 30 seconds, upstream errors after one minute, and
temporarily unsupported sources after one minute.
Cache hits preserve the original `sampledAt` and `expiresAt`. The Cache API
stores entries only in the data center handling the request and may evict them.
Requests in another data center or after eviction may repeat provider calls.
Each cache operation waits at most 500 ms before the response continues;
Cloudflare's `waitUntil` lets a slow write finish after the response. Provider
failures, including directory DNS failures and incomplete
enrichment, are not stored as successful results. The existing local
now-playing cache and in-flight deduplication remain, capped by the snapshot's
expiry.

Episode enrichment stores descriptive fields. Radio Garden resolves playback
URLs on each request, outside the station cache. Radio Browser caches search
descriptions and validated query-free playback URLs. Query-bearing URLs stay
outside the cache and are refreshed together by station UUID on cache hits.
These searches still need one provider lookup; searches with only query-free
URLs need none. Browser playback probes and player state stay local.

The production Worker runs on the `radio.avoid.quest` custom domain, where
Cloudflare supports Cache API operations. `workers.dev`, Dashboard editor,
and Playground previews do not persist Cache API entries. See [Cache API behavior](https://developers.cloudflare.com/workers/runtime-apis/cache/)
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
