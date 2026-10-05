# radio

PWA internet radio player with advanced audio mixing, effects chain, and MIDI support.

## Features

- **3 Playback Modes**
  - **Single**: focused single-station player; switching releases the old sound before loading its replacement
  - **Node**: a patch canvas (React Flow) where Station nodes are cabled into a Speakers node with Play all and master volume; `/` opens the node palette, and edits are undoable. On phones the Stage and Rack tabs list every source with play and volume. Node replaced Multiple: a stored Multiple session, mode or backup becomes a Node patch with the same stations, order and levels
  - **DJ**: two-deck mixer with crossfader, channel strip, effects chain, CUE monitoring, MIDI control
- **Audio DSP**: official openDAW effects engine plus a radio AudioWorklet compatibility runtime; see [runtime selection](OPENDAW_EFFECTS_IMPLEMENTATION.md#architecture)
- **Platform support**: Bandcamp albums/tracks, SoundCloud playlists/tracks, YouTube playlists/videos, and Radio Browser/Radio Garden stations
- **External inputs**: device audio input (mic/line-in), local files and folder playlists, shared browser tab audio in Node and DJ
- **PWA**: installable with a network-only service worker; no offline shell cache
- **Persistence**: TanStack DB collections backed by localStorage — radios, settings, playback sessions
- **Visualizations**: peak meters, EQ and compressor curves
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

Both modes offer **Browser tab audio** and **Radio episodes / shows** as
shared-tab sources. Open the source in another tab, play it there, then use
**Go live** (Node) or **Share tab audio** (DJ), choose that tab and enable
**Share tab audio** in the browser picker. Pasted supported station archive
links load the same shared-audio source; direct audio-file and playlist URLs
retain the normal seekable player. Tracks, shows and seeking are controlled in
the source tab. Sharing is never restored automatically. Spotify and Mixcloud
are not shared tabs: they play as tracks (see
[Mixcloud and Spotify tracks](#mixcloud-and-spotify-tracks)). A Spotify or
Mixcloud tab saved by an earlier release still loads as Browser tab audio under
its name.

This uses the browser's `getDisplayMedia`, with desktop Chrome/Edge recommended.
Only another browser tab can be shared: window, screen and system audio can
contain the mixer's own output and feed it back, so they are excluded from the
picker and refused if chosen. For desktop software, use a virtual audio input
device instead. Protected playback may be silent. Only the selected tab's audio
reaches the mixer; the picker requires a video track, but the app does not
render, record or upload it. See Chrome's
[screen-sharing controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls)
for browser capture capabilities.

## Mixcloud and Spotify tracks

Mixcloud shows play like SoundCloud tracks: search Mixcloud or paste a show
link. The server resolves the show and the browser plays its HLS stream
directly. Spotify has no search: paste a track, album or playlist link. The
server reads Spotify's public metadata and the browser plays the matching
YouTube upload, matching album and playlist tracks as they play. Other
Spotify pages (artists, podcasts) and Mixcloud pages other than shows don't
play. See the [Mixcloud](../../packages/platforms/src/mixcloud/RESEARCH.md) and
[Spotify](../../packages/platforms/src/spotify/RESEARCH.md) research.

## Tech Stack

- **Routing**: TanStack Start + TanStack Router (file-based, SSR disabled for UI routes)
- **State**: TanStack DB (persisted), TanStack Store (runtime), TanStack Query (platform metadata)
- **Throttling**: `@tanstack/react-pacer` (`useThrottledCallback`)
- **DSP**: official openDAW Rust/WASM engine for supported active effect trees; radio AudioWorklet with `@opendaw/lib-dsp` primitives for compatibility
- **Audio**: Web Audio API, AudioWorklet, HLS.js, HTML5 Audio
- **UI**: React 19, Tailwind CSS v4, shadcn/ui, Radix UI, dnd-kit
- **Deploy**: Cloudflare Workers (Wrangler)
- **Monitoring**: Sentry (browser via `/tunnel`, Worker via its SDK)

## Routes

| Route | Description |
|-------|-------------|
| `/` | Main player — switches between Single / Node / DJ mode |
| `/import` | Batch import radios from a URL or JSON |
| `/api/feedback` | GitHub issue feedback endpoint |
| `/api/radio-metadata` | Metadata lookup for configured radio streams |
| `/api/radio-blackout-stream` | Dedicated BlackOut audio relay |
| `/api/stations.json` | Default station catalog |
| `/playlist.m3u` | Default stations as an M3U playlist |
| `/legal` | Source and license information |
| `/manifest` | PWA web app manifest (dynamic) |
| `/tunnel` | Sentry envelope tunnel |
| `/u/script.js` | First-party Umami tracker (GET/HEAD) |
| `/u/api/send` | First-party Umami event collection (POST) |

Server functions (TanStack Start `createServerFn`; paths relative to `src/`):

| Function file | Description |
|--------------|-------------|
| `utils/platform.functions.ts` | Bandcamp, SoundCloud, Mixcloud and Radio Garden resolution; Spotify metadata |
| `utils/search.functions.ts` | Bandcamp, SoundCloud and Mixcloud search |
| `utils/radio-garden.functions.ts` | Radio Garden search and suggestions |
| `utils/radio-browser.functions.ts` | Shared Radio Browser directory search |

Most playback streams go directly to the browser. BlackOut is an intentional
exception: [`/api/radio-blackout-stream`](src/routes/api/radio-blackout-stream.ts)
relays its fixed upstream audio streams. Metadata retrieval can also briefly
read stream bytes to extract ICY metadata, including BlackOut's fallback when
its listening API has no usable result; the bounded probe closes the stream
and returns metadata, not playback audio (see
[`retrieval.ts`](src/lib/metadata/retrieval.ts)). Static audio URLs and M3U/PLS
playlists are resolved directly in the browser. Bandcamp's fresh, validated
`bcbits.com` media URLs use the curated, release-tested public relay pool
`seep.eu.org`,
`proxy.cors.sh`, then `cors.zme.ink`; the browser range-probes the pool under one
deadline before selecting the highest-priority working relay. YouTube tries the
curated, release-tested providers `pipedapi.wireway.ch`, `yt.omada.cafe`,
`invidious.nikkosphere.com`, then `y.com.sb`, with per-provider and whole-pool
deadlines. See `BANDCAMP_RELAY_RESEARCH.md` and
`YOUTUBE_PROVIDER_RESEARCH.md` for the release probes and caveats.

## Analytics

The root shell loads Umami once with website ID
`3c1fb87b-fc98-4b89-b359-59f386c01ad3`. Tracking runs only on
`radio.avoid.quest`, honors Do Not Track and Umami's `umami.disabled`
localStorage opt-out, and excludes URL query strings and hashes. Umami handles
client-side navigation automatically.

Following Umami's [proxy guide](https://docs.umami.is/docs/bypass-ad-blockers)
and [tracker configuration](https://docs.umami.is/docs/tracker-configuration),
the script uses `/u/script.js` and `data-host-url="/u"`, so event requests stay
on `/u/api/send`. The Worker proxies only these two paths to
`https://umami.net-work.studio`; no credentials or additional bindings are
needed. Event bodies are limited to 64 KiB, including streamed requests without
a reliable Content-Length. Successful scripts are cached for an hour, while collection responses
and failures are never cached. First-party proxying reduces domain-based
blocking; it does not guarantee that every blocker will allow tracking.

The proxy forwards the browser's user agent, Umami session headers, and
available [Cloudflare location headers](https://docs.umami.is/docs/enable-cloudflare-headers).
It sets Umami's built-in `payload.ip` from Cloudflare's incoming
`CF-Connecting-IP`, replacing any browser-supplied IP. This avoids
[Cloudflare's cross-zone IP-header rewrite](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip-in-worker-subrequests).
[Umami prioritizes `payload.ip` over headers and uses its geo database for that IP](https://github.com/umami-software/umami/blob/master/src/lib/detect.ts).
No `CLIENT_IP_HEADER` setting or custom header is required on the Umami server.
When Cloudflare's visitor header is unavailable, the proxy removes any
client-supplied `payload.ip` and leaves Umami's standard header fallback intact.
Event fields and session headers are otherwise preserved; malformed JSON and
invalid payload shapes are rejected before forwarding. Confirm visitor/session
attribution in the dashboard after deployment. The Astro site's analytics
setup is independent.

Umami uses IPs transiently for location metrics and anonymous session hashes;
[it does not store the IP address](https://docs.umami.is/docs/metric-definitions).
The proxy keeps Umami's standard visitor attribution instead of replacing IPs
with a shared placeholder. Security logs omit visitor IPs, and the existing
Cloudflare rate limiting remains in place.

Sentry's shared configuration follows its documented
[`dataCollection` controls](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/data-management/data-collected/):
`userInfo: false`, cookies and bodies disabled, and IP-bearing headers/query
parameters excluded. The app does not explicitly set a Sentry user/IP. Sentry's
**Prevent Storing of IP Addresses** setting under **Security & Privacy** is an
additional server-side safeguard. Provider access logs and historical data are
managed outside this repository and are not verified by these SDK settings.

## Architecture

When changing Node Mode graph rules, playback, persistence or editing, read the
[current v1 contract and source map](src/components/radio/NODE_MODE_PROPOSAL.md).
It links to historical design and future roadmap material only when those are needed.

Single replacement is owned by [`single-playback.ts`](src/lib/single-playback.ts).
It preserves play/pause intent, cancels superseded selections, and attempts to
restore the previous station after a failed replacement when a prior sound
existed. There is no overlapping station crossfade.

### State layers

```
┌─────────────────────────────────────────────┐
│  TanStack DB (localStorage)                  │
│  radiosCollection · settingsCollection       │
│  playbackSessionsCollection                 │
├─────────────────────────────────────────────┤
│  TanStack Store (in-memory runtime)          │
│  playbackRuntimeStore — per-channel         │
│  transport, soundId, peaks; djUiStore — UI   │
├─────────────────────────────────────────────┤
│  TanStack Query (server state cache)         │
│  platform metadata, search results          │
└─────────────────────────────────────────────┘
```

### Audio signal path (DJ mode)

```
Media source → Pan → Filter → Effects backend
Device input → Filter → Effects backend → Pan
  → PreFaderSend (CUE tap) → Gain (fader)
  → Main output (delay for media; direct for device input)
  → Destination (speakers)

CueBus: PreFaderSend → CueSumNode → CueDelayNode
  → HeadphoneGain → MediaStreamDest → Headphones (setSinkId)
```

The effects backend selects bypass, official openDAW, or compatibility for
the whole active effect tree, including nested containers. See
[effects architecture and limits](OPENDAW_EFFECTS_IMPLEMENTATION.md) and
[`audio-manager-graph.ts`](src/lib/audio/manager/audio-manager-graph.ts).
Meters tap the signal separately from the output path.

## Environment variables

### Development (optional)

```
GIT_FEEDBACK_GITHUB_TOKEN= # Fine-grained token with Issues read/write
```

No secret manager or custom variable is required to start the radio app. Set
`GIT_FEEDBACK_GITHUB_TOKEN` through the standard Cloudflare local environment
only when exercising feedback submission locally.

### Build-time (Sentry client and sourcemap upload)

```
VITE_RADIO_SENTRY_DSN # Optional browser DSN override; also used by /tunnel fallback validation
SENTRY_AUTH_TOKEN   # Required for sourcemap upload
SENTRY_ORG          # Sentry organization slug
SENTRY_PROJECT      # Sentry project slug
SENTRY_RELEASE      # Optional browser/Worker/upload release override
```

Production builds use the committed public radio DSN only when served on
`radio.avoid.quest` and the override is absent. An explicitly empty or
whitespace-only override disables browser reporting. Development, previews,
forks and self-hosted deployments stay disabled unless a DSN override is
provided. The `/tunnel` fallback applies the same hostname policy to the
request URL; an explicit runtime DSN still takes precedence.

If any required Sentry build vars are missing, production builds print one
warning and skip the upload step. The app still builds with hidden source maps;
set all three required vars in release/deploy environments to upload them.

### Runtime (Sentry)

```
RADIO_SENTRY_DSN    # Optional server DSN and primary /tunnel validation target
SENTRY_DSN          # Optional fallback server DSN name
```

The Worker reads these bindings per request in [`src/server.ts`](src/server.ts).
`withSentry` isolates request scopes and delivers events through `waitUntil`;
[`src/start.ts`](src/start.ts) catches TanStack middleware failures. Node
`--import` initialization does not instrument the deployed Worker.

Local development works without Sentry variables. Browser reporting is disabled,
the Worker has no active transport, and `/tunnel` returns 503 until a DSN is
configured. Browser, Worker and source-map upload share the build-time release. Tracing,
Replay, logs and metrics are disabled; error sampling is 100%.

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

Run from the repository root; radio needs no Doppler setup:

```bash
bun run --filter @avoid.quest/radio dev       # Port 3000
bun run --filter @avoid.quest/radio build
bun run --filter @avoid.quest/radio typecheck
bun run --filter @avoid.quest/radio test
bun run --filter @avoid.quest/radio cf-typegen # Regenerate bindings
```

For explicitly requested deployments, see the
[repository deployment commands](../../DEVELOPMENT.md#cloudflare-deployment).
