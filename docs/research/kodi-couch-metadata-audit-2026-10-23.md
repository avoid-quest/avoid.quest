# Kodi / Couch radio metadata audit — 2026-10-23

This document preserves the initial audit and its source snapshots. The implementation handoff and subsequent verification below describe the resulting code changes.

The Kodi-compatible endpoint is a ten-station extended M3U. Rich programme metadata already exists in a separate JSON API, and current Couch mainline consumes both. The largest missing capabilities are static station details in the public catalog, explicit programme timing/next-show data, and an XMLTV guide for stock Kodi. Couch already uses most useful fields in the current JSON response.

Both local repositories matched their remote main branches when inspected. This is a research-only change: source inspection, live provider GETs, focused provider tests, and mocked Couch consumer probes; no application code was changed.

**Implementation follow-up:** the audit below records the original baseline.
Provider implementation was subsequently added in this worktree; see the
follow-up at the end and the [current integration contract](../../apps/radio/README.md#m3u-and-xmltv-for-kodi-and-other-players).

## What avoid radio publishes

Provider source: avoid.quest `169d0960b08dc682c748c4ef0a7f4637cf621c96`, which matched GitHub `HEAD` and `main` on 2026-10-23 (`git ls-remote origin HEAD refs/heads/main`). The worktree and the dependency-installed main checkout had this same commit. Production catalog JSON and M3U matched local generation exactly during this audit; this establishes those two responses, not the revision of every deployed module.

There are three distinct surfaces, all under `https://radio.avoid.quest`:

| Surface | Exact content | What it does not include |
| --- | --- | --- |
| [`/playlist.m3u`](https://radio.avoid.quest/playlist.m3u) | `#EXTM3U`; one `#EXTINF:-1` with `tvg-id`, `tvg-name` (spaces become underscores), optional `tvg-logo`, `group-title="avoid radio"`, `radio="true"`, display name; then the original stream URL. Ordering follows `order`, then name. | No now-playing information, programme guide URL, XMLTV, description, station website, explicit stream format, channel number, or custom metadata API discovery. |
| [`/api/stations.json`](https://radio.avoid.quest/api/stations.json) | `{ stations: [...] }`; each entry has `id`, `name`, `streamUrl`, optional `logoUrl`, `groupTitle`, `order`. | No extra metadata beyond the playlist's catalog information. In particular, no `description`, `websiteUrl`, `streamFormat`, or metadata capability/endpoint field. |
| [`/api/radio-metadata?stationId=avoid-radio-nts-radio-channel-1`](https://radio.avoid.quest/api/radio-metadata?stationId=avoid-radio-nts-radio-channel-1) | `{ ok: true, data, refreshAfterMs }` for a successful current snapshot. `data` has `streamUrl`, optional `resolvedUrl`, `source`, nullable `title`, `artist`, `rawTitle`, `album`, `artworkUrl`, `itemUrl`, `stationName`, `stationDescription`, `genre`, `bitrate`, plus numeric `sampledAt` and `expiresAt`. | No structured current/next schedule, programme start/end, stable episode ID, live/replay flag, tracklist, history, or audio archive URL. |

Sources: [playlist and public catalog projection](../../apps/radio/src/lib/kodi-playlist.ts), [M3U route](../../apps/radio/src/routes/playlist%5B.%5Dm3u.ts), [JSON route](../../apps/radio/src/routes/api/stations%5B.%5Djson.ts), [metadata contract](../../apps/radio/src/lib/metadata/types.ts), [lookup and response envelope](../../apps/radio/src/lib/metadata/metadata-workflow.ts). These are source definitions, not proposed API changes.

The two catalogs export the **ten hardcoded defaults** in [const.ts](../../apps/radio/src/lib/const.ts), not a listener's edited/favorite stations, imported playlists, or Radio Garden / Radio Browser search results. Eligibility is a nonempty name, not explicitly disabled, and an absolute HTTP(S) stream URL. The export helper does not probe stream availability. Audio still comes from those station URLs; this is not a general relay/transcoding endpoint. The app's [BlackOut playback relay special case](../../apps/radio/src/lib/audio/playback/radio-blackout.ts) is not substituted into the exported playlist.

Both catalog routes advertise `public, max-age=300, stale-while-revalidate=3600`. The metadata endpoint resolves the station's stream and provider configuration internally; caller `url`/`kind` parameters cannot override an explicit station ID. Unknown IDs return 404. An unsupported metadata source returns HTTP 200 with `ok: false`, so clients must inspect the body. Successful responses are `private, no-store`; provider retrieval is shared through an internal expiring cache. See [workflow](../../apps/radio/src/lib/metadata/metadata-workflow.ts), [cache](../../apps/radio/src/lib/metadata/cache.ts), and [consumer contract](../../apps/radio/README.md#shared-radio-metadata).

`resolvedUrl` identifies a metadata source/lookup URL in provider implementations (e.g. the NTS live API); it is **not a replacement playback URL**. `stationDescription` is frequently the current show/episode description, not the station's static description. `album` can hold a series name (Resonance), and `artist` can hold a host. These are display-oriented fields with mixed programme/track semantics. [NTS normalization](../../apps/radio/src/lib/metadata/external-providers.ts#L1660), [Resonance normalization](../../apps/radio/src/lib/metadata/external-providers.ts#L2001).

### Confirmed live metadata coverage

On 2026-10-23, bounded `curl` GETs using the service's anonymous session cookie returned HTTP 200 / `ok: true` / a title for all ten default station IDs. Artwork and descriptions were populated for eight stations; the sampled Cashmere and Radio Alhara responses had neither. Programme links were populated for seven, genres for four, artists for two, album/series for one, and bitrate for none. This is one snapshot of nullable fields, not a guarantee of complete metadata or a playback health check.

For example, NTS 1 returned “MARTHA b2b Dub Athlete”, episode artwork, an NTS episode page, a description, genre `Techno`, and fresh cache timestamps; `artist`, `album`, and `bitrate` were null. This confirms rich metadata is already externally exposed. A client should not assume every station fills every field.

### What “Kodi-compatible” actually means

The playlist uses the channel elements supported by Kodi's IPTV Simple client. Kodi documents `radio="true"`, the `tvg-*` attributes, and `group-title` for channel ingestion. Rich EPG information is supplied separately through **XMLTV**, matched to `tvg-id`; its programme fields include title, description, artwork, category, and start/stop. The M3U header can advertise it with `x-tvg-url`. [Official IPTV Simple documentation](https://github.com/kodi-pvr/pvr.iptvsimple/blob/Piers/README.md#supported-m3u-and-xmltv-elements), read 2026-10-23.

Our header is just `#EXTM3U`; the route inventory has no XMLTV/EPG export. Therefore the playlist supports station listing/playback but does not connect stock IPTV Simple to our rich JSON now-playing API. A compatible player's own handling of upstream ICY/HLS metadata is separate from what our export publishes. No Kodi device playback was exercised during this audit.


## Couch consumer findings

This section traces the inspected Couch code. Consumer limitations below are distinguished from provider omissions and observed live responses.

Couch consumes avoid radio as a built-in **extended M3U station catalog plus a separate JSON now-playing service**. It is not using Kodi's runtime or a Kodi add-on to obtain the programme information. Its configured inputs are `https://radio.avoid.quest/playlist.m3u` and `https://radio.avoid.quest/api/radio-metadata?stationId=<M3U tvg-id>`. Audio comes from each M3U entry's stream URL, possibly through Couch's own delivery relay. The JSON request is server-side, and Couch distributes the validated result to its clients. [C1–C5, C12–C14]

### Source selection and freshness

- Inspected checkout: `/home/avoid/Code/avoid-quest/couch`, branch `main`, clean at initial and subsequent read-only status checks.
- Inspected commit: **`3e603a5a82ee746eaa5e8344a882a493de80b797`**, committed `2026-10-23T18:15:12+02:00`, subject `Simplify updates and align settings with Couch’s design (#886)`.
- `git ls-remote --symref https://github.com/avoid-quest/couch.git HEAD refs/heads/main` reported `HEAD → refs/heads/main` and the same SHA for both. Thus local `main` matched the remote default branch when inspected; this says nothing about the owner's installed release or deployment.

### Catalog loading, persistence, and identity

1. The built-in source has fixed Couch playlist ID `544da8af-6077-80f3-a15b-884c42740444`, name `avoid radio`, and the M3U URL above. `avoid()` inserts it into SQLite on demand. It refreshes when never loaded or more than **one hour** old, or explicitly forced; ordinary failures have a **60-second** retry gate. Refreshes are deduplicated per playlist and have a **10-second** overall abort budget. This is demand-driven refresh, not an hourly background timer. [C1, C2]
2. Successful refresh replaces that source's station rows transactionally, stores order and `updatedAt`, clears its error, and updates matching saved-favorite records. A failed refresh stores an error while preserving the prior station rows. A fresh install with a failed first request can therefore have an empty built-in catalog. [C2]
3. The client browses through Couch's paired-device endpoints `/api/radio/avoid` and `/api/radio/avoid/programmes`. A browse retry can request `?refresh=true`. Built-in station queries use a shared query key and **30-second** client stale time; station-name/group filtering happens locally. The built-in source cannot be removed. Custom playlists and Radio Browser are separate discovery sources. [C2, C6, C7]
4. Couch station IDs are deterministic SHA-256-derived UUID-shaped values over `sourceId + NUL + "tvg:" + tvgId`, falling back to `"url:" + streamUrl` if there is no `tvg-id`. Repeated IDs in a feed are skipped. Consequently, a stream URL change preserves saves/queue references when `tvg-id` stays stable; changing `tvg-id` changes identity. Without `tvg-id`, a stream URL change also changes identity. [C3]
5. A tracked ten-station snapshot exists at `src/server/radio-playlists.avoid.m3u`, including provider IDs, logos, names, and direct audio/HLS URLs. A repository-wide reference search found **no runtime import or read of this file**; the catalog loader fetches the remote URL. Treat this as a duplicated snapshot, not a proven offline fallback or evidence of today's live catalog contents. [C2, C18]

### What the M3U consumer keeps and discards

| Input | Couch behavior | Consequence |
| --- | --- | --- |
| Display name after `#EXTINF` comma | `channel.name`, falling back to `channel.tvgName`; trimmed, 1–200 characters, no control characters | Station title and queue title. `tvg-name` is not retained separately. |
| `tvg-id` | Stored as `tvgId`; used for local identity and as JSON `stationId` | This is the principal cross-feed integration key, not Couch's generated UUID. |
| `tvg-logo` | Resolved against final playlist URL; valid HTTP(S) becomes `logoUrl` | Station artwork fallback. Invalid artwork is omitted without rejecting the station. |
| `group-title` | Stored as `groupTitle`, at most 200 characters | Search text and UI fallback/category text. |
| `radio` | Entries with `radio="false"` or `radio="0"` are skipped | Missing/other values are accepted; `radio="true"` is not required. |
| Stream URI | Resolved relative to final playlist URL and stored as `url` | Playback source, and expected `data.streamUrl` for metadata validation. |
| Other playlist metadata | Not mapped into `RadioStation` | No radio-path mapping for header EPG URLs, programme schedule, channel numbering, catch-up, or arbitrary extras. |
| Homepage, country, codec, bitrate | Playlist parser always sets `homepage: null`, `countryCode: ""`, `codec: ""`, `bitrate: 0` | These fields exist in Couch's generic station model, but M3U ingestion does not populate them. The Radio Browser adapter is a different path. |

Source: the complete radio parser and model [C1, C3]; the separate Radio Browser adapter is `src/server/radio.ts:45–57` [C2]. This table describes what Couch consumes, not which optional fields the provider currently emits.

The importer requires an extended M3U starting with `#EXTM3U`, a title and exactly one URL per entry, at most **5,000 entries** and **2 MiB**, and no more than three redirects. It sends `User-Agent: Couch/0.1` and an M3U/text `Accept` header. URLs must be HTTP(S), without embedded credentials, whitespace/control characters, backslashes, or pipe header suffixes. [C3]

**Kodi compatibility is a subset here.** `#KODIPROP`, `#EXTVLCOPT`, `#EXTHTTP`, `#WEBPROP`, and user-agent/referer/cookie/authorization attributes cause the import to fail, rather than being applied or silently ignored. `#EXT-X-*` rejects an HLS manifest used as the *station catalog*; an ordinary M3U station entry pointing at an HLS stream is supported. Adding otherwise valid Kodi-specific directives to a shared feed could therefore break Couch's catalog refresh. [C3, C14]

### Programme metadata request and field contract

For browsing, `avoidProgrammes()` loads the catalog and requests metadata for stations with `tvgId`, using batches of **three**, only the first **50** catalog entries, and a **30-second** caller budget including catalog loading. Results are keyed by Couch's station UUID, while each `RadioProgrammeDetails.stationId` contains the requested provider `tvg-id`. [C2]

For active playback, `programmeStation()` recognizes only `radio:<Couch UUID>` sources whose current catalog row joins to the **exact** built-in playlist URL. It returns the `tvgId` and stream URL. Merely pasting the same stream URL, importing a mirror at a different playlist URL, or finding that station in Radio Browser does not activate this rich-metadata path. A favorite surviving only in `radio_favorites` can remain playable while no longer matching the metadata lookup in `radio_playlist_stations`. [C2, C12]

The metadata client sends `GET /api/radio-metadata?stationId=...`, accepts JSON, rejects redirects, and applies a **10-second** request timeout and **64 KiB** response-body limit. It saves only a matching `radio_session_id` cookie and reuses it across requests in this metadata instance. No user token or station-specific retrieval credentials are supplied by this code. [C4]

| Provider response field | Validation / mapping | Use in Couch |
| --- | --- | --- |
| `ok`, `data` | Requires `ok === true` and a non-array object `data` | Envelope gate; invalid/failure responses become no programme. |
| `data.streamUrl` | Normalized HTTP(S) URL must equal the playlist-derived expected URL | Identity guard; discarded after validation. No redirect/alias equivalence. |
| `data.title` | Nonempty string, at most 500 characters, trimmed | Programme title. Required even when optional metadata exists. |
| `data.sampledAt` | Finite number, no more than 60 seconds in the future | Retained freshness field; not shown in the examined UI. No maximum historical age is enforced independently of expiry. |
| `data.expiresAt` | Finite number, after now and after `sampledAt`, at most 24 hours ahead | Cache boundary and active refresh deadline, not a programme end time. |
| `data.artworkUrl` | Valid HTTP(S), no credentials/header suffix | `artworkUrl`; otherwise omitted. |
| `data.itemUrl` | Same URL validation | Renamed `programmeUrl`; Details' external browser action. |
| `data.stationDescription` | String, at most 10,000 characters, trimmed | Renamed `description`, displayed as programme detail text. |
| `data.genre`, `artist`, `album` | Individually nonempty strings, at most 500 characters, trimmed | Display metadata; artist/album also reach OS Media Session. |
| `data.bitrate` | Finite positive number, at most 10,000 | Retained as programme metadata; Details labels it `kbps`. Does not populate the station's bitrate or control playback. |
| Any other JSON fields | Not copied by the explicit mapping | No consumer support merely because the provider adds them. In particular there are no current/next schedule, programme start/end, station website, codec, provenance, stale-state, or metadata-endpoint fields in this result model. |

Source: complete validator and fetch/cache code [C4], output type [C1], UI [C8–C11]. Couch sets `stationId` to its **request argument** and `provider` to the literal `radio.avoid.quest`; it does not validate a returned `data.stationId` or use a provider-supplied provider discriminator. The stream URL equality check is the implemented binding. Optional fields can be dropped independently; a bad required field rejects the whole programme. [C4]

### Cache, refresh, and failure behavior

- A single metadata instance is shared by catalog discovery and the active playback updater. It caches by `stationId + NUL + streamUrl`, coalesces concurrent requests, and keeps approximately 100 entries with insertion-order eviction. A valid programme is reused until its `expiresAt`; ordinary errors or invalid responses produce a null result with a **60-second** retry time. This is process memory, separate from persisted SQLite station rows. [C2, C4, C12]
- HTTP 429 parses numeric or date `Retry-After`, clamps the backoff to **30 seconds–15 minutes** (default 60 seconds), and applies it across stations in the instance. Existing fresh cache entries are returned before that global backoff gate. A caller abort stops its wait without cancelling another listener's shared fetch; provider work has its own timeout/shutdown signal. [C4]
- Active playback starts programme refresh only after the resolved stream matches the catalog mapping and the player is `playing` or `paused`. A valid response is published with a `playbackId`; refresh is scheduled for `retryAt`. At the expiry timer, the previous result is cleared before refreshing. Changing playback stops the former loop and clears its programme. Metadata errors never intentionally interrupt audio. Session publication rejects results for the wrong playback or inactive status. [C5, C12, C13]
- Browsing, Home, Search, Details, and the player fallback use the shared programme query with **60-second** polling where enabled and **30-second** query stale time. This can poll Couch more often than Couch requests the provider, because the server cache respects the provider's expiry. Home/Search check `expiresAt` before displaying a result. The code comment suggesting approximately 15-minute expiry is not a hardcoded TTL; actual code uses the returned timestamp. [C7–C10]
- Couch does not send `If-None-Match`/`If-Modified-Since` or derive metadata retry times from `Cache-Control`; JSON `expiresAt`, local failure intervals, and 429 headers are the mechanisms in this path. Playlist fetching similarly sends no conditional validators. [C3, C4]

### Where listeners see the metadata

- **Home / radio shelf:** recent and saved stations precede built-ins; current show title and genre enrich the station's text. The hero and player presentation prefer programme artwork, falling back to station artwork. [C8, C17]
- **Search / browse:** station name remains the result title, with programme title, genre, artist, group/source, description, and programme artwork where available. Filtering is still station name/group, not programme title/artist/description. [C7, C9]
- **Station Details:** programme title replaces the station title; station name, genre, artist, album, and bitrate appear as metadata, followed by description. `programmeUrl` is the preferred external link, then station homepage. Because the M3U parser leaves homepage null, a playlist station without an item URL has no station website action from these fields. [C3, C10]
- **Now playing and OS integration:** the player uses show title/art/genre/artist and suppresses a radio end time. Browser Media Session receives programme title, artist, album, and artwork, falling back to player/queue metadata. Native window title also prefers the programme title. These are separate from persisting a richer station catalog. [C11, C16]

### Playback path and boundaries

`enqueueRadio` resolves the saved catalog station, creates a `radio:<UUID>` queue entry with station title/logo, `kind: "radio"`, and `live: true`. At load it resolves the **current** station stream again, attaches the programme updater, and returns the stream with `radio: true`. Thus the queue keeps station identity while metadata can describe the changing programme; rich metadata is not required to resolve audio. [C2, C12, C13]

Couch's general delivery layer probes whether the selected device can access media. It can keep the original source or use a signed Couch `/api/relay/...` URL for origin/CORS/mixed-content limitations, rewriting HLS child references when relaying. That pass-through does not transcode. Browser devices use media elements with native/HLS.js paths; synchronized speaker playback uses Core's FFmpeg/Sendspin path (48 kHz stereo, Opus or PCM). These are Couch playback mechanisms, not an avoid radio audio-proxy contract. The radio catalog load path does not request mpv decoding or choose alternate codec/quality variants. [C12, C14, C15]

Radio has a bounded reconnect budget of **1, 2, and 4 seconds**, reset after sustained observed playback. UI transport hides an end-time estimate and, for unseekable live audio, pause/seeking controls. This provides live streaming, not an implemented radio schedule/catch-up interface. [C16]

No ICY metadata parser/fetcher was found in the inspected radio client, browser renderer, mpv property observer, or Sendspin code. The UI/protocol has a generic `player.nowPlaying` fallback, but the browser renderer's published state does not populate it, and mpv observes time/duration/pause/seekability/speed rather than metadata. Do not infer working ICY/title extraction from the fallback UI alone. [C11, C14, C15, C19]

### Consumer gaps and integration implications

These are code-derived findings, not claims about the live provider's missing fields or demonstrated production failures.

1. **The M3U alone cannot deliver Couch's rich experience.** The JSON endpoint, literal endpoint URL, `tvg-id`, exact stream match, cookie handling, and expiry semantics form an additional consumer contract. A generic Kodi-compatible playlist consumer need not implement any of it. Custom/mirrored playlists are not automatically enriched even if they retain identical IDs/streams. [C1–C5]
2. **Metadata extensibility stops at a small whitelist.** The model has one title and optional artist/album/genre/description/art/link/bitrate, with no separate show-versus-track structure, start/end/next schedule, archive playback URL, station website/description distinction, codec/variant list, provider provenance, or stale/error detail. Provider additions require a Couch mapping/UI change before listeners benefit. The `stationDescription → description` mapping should be checked against the provider's intended station-versus-programme semantics. [C1, C4, C10]
3. **Catalog and metadata changes must remain coherent.** The catalog may be an hour old while programme data refreshes sooner. A changed metadata stream URL causes otherwise useful programme data to be dropped until the M3U refresh catches up. Stable `tvg-id` values preserve Couch identity, but are not sufficient to bypass that URL guard. [C2–C5]
4. **One active updater for potentially multiple playbacks.** Hub has one `radioProgramme` and one mutable `radioPlayback`; each `radio:` load overwrites that selection, and only that playback's published state is observed. The updater itself holds one `active` and one `loaded` record. This is a structural limit for concurrent independent radio playbacks: each does not receive its own expiry-driven updater. Client browse polling can provide a fallback for their display, but is not an equivalent per-playback publication mechanism. Simultaneous-device behavior was not exercised. [C5, C8, C12]
5. **Expiry handling differs by view.** Home and Search explicitly discard expired results. `RadioDetails` reads `programmes.data?.[item.id]` without an expiry guard; `useStationShow` accepts a matching playback programme without checking expiry, relying on server clearing. Failed refreshes, lost updates, or inactive query polling can therefore leave stale display data in these paths. This is a source-level risk, not a reproduced UI failure. [C8–C10]
6. **Discovery has bounded scale and no programme search.** Only the first 50 built-in stations are enriched in one browse request; batching plus the 30-second budget can yield a partial result with no per-station error explanation. Search matches station name/group despite showing rich show metadata. The importer permits far more stations than discovery enrichment covers. [C2, C3, C7, C9]
7. **There is duplicated station data but no station-specific retrieval implementation.** Couch stores its SQLite catalog/favorites and has a tracked M3U snapshot; it does not duplicate the provider's station-specific metadata adapters in the examined path. Local metadata caching is a consumer cache layered on the provider cache, explicitly shared by discovery and playback. The unused snapshot should not be counted as resilience. [C2, C4, C18]


### Validation and limits

- Read-only Git checks established the selected SHA and matching remote `main`; `rg` and numbered source reads traced the caller, validator, persistence, UI, and delivery paths. Repository-wide search found no use of the bundled M3U snapshot.
- Ran a successful **in-memory `bun -` smoke probe from the Couch root**, importing the unmodified `readRadioPlaylist` and `createRadioMetadata`, reading the tracked M3U, and mocking all fetch responses. Assertions covered: ten fixture stations; blank homepage/bitrate; stable identity after a stream URL change with unchanged `tvg-id`; rejection of `KODIPROP` and an HLS catalog; response whitelist/mapping; ignored returned station ID versus requested ID; exact stream-match rejection; concurrent fetch coalescing; cache reuse then refetch at expiry; session-cookie reuse; and global 429 backoff with the 30-second minimum. All three probe groups passed. No fixture files, database, server, or network metadata/audio requests were created by the probe.
- No Couch code changed. Couch builds and its full test suites were not run. Report paths and source line references were checked; provider tests are recorded under Provider verification below.
- Not verified in Couch: audible station playback, device codec compatibility, multi-device concurrency, or rendered UI. No running Couch installation or its data was accessed. The provider audit separately verified live payloads. The consumer smoke probe used fixtures and mocked responses; it was not a live interoperability test.

### Couch source index

All local paths resolve under `/home/avoid/Code/avoid-quest/couch`; all immutable links use SHA `3e603a5a82ee746eaa5e8344a882a493de80b797`.

- **C1 — types and configured catalog:** [local src/shared/radio.ts:1](/home/avoid/Code/avoid-quest/couch/src/shared/radio.ts:1), lines 1–53; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/shared/radio.ts#L1-L53).
- **C2 — catalog persistence, refresh, batching, lookup:** [local src/server/radio.ts:74](/home/avoid/Code/avoid-quest/couch/src/server/radio.ts:74), lines 16–57, 74–171, 202–225, 248–275, 297–346; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/radio.ts#L74-L346).
- **C3 — M3U parser and fetch constraints:** [local src/server/radio-playlists.ts:1](/home/avoid/Code/avoid-quest/couch/src/server/radio-playlists.ts:1), lines 1–112; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/radio-playlists.ts#L1-L112).
- **C4 — JSON validator, cache, cookie, rate limits:** [local src/server/radio-metadata.ts:1](/home/avoid/Code/avoid-quest/couch/src/server/radio-metadata.ts:1), lines 1–103; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/radio-metadata.ts#L1-L103).
- **C5 — active programme state and refresh loop:** [local src/server/radio-programme.ts:1](/home/avoid/Code/avoid-quest/couch/src/server/radio-programme.ts:1), lines 1–58; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/radio-programme.ts#L1-L58).
- **C6 — paired-device API surface:** [local src/server/radio-settings.ts:7](/home/avoid/Code/avoid-quest/couch/src/server/radio-settings.ts:7), lines 7–58; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/radio-settings.ts#L7-L58).
- **C7 — client queries and filtering:** [local src/client/api/radio.ts:26](/home/avoid/Code/avoid-quest/couch/src/client/api/radio.ts:26), lines 26–69; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/api/radio.ts#L26-L69).
- **C8 — Home/player programme selection and expiry:** [local src/client/sections/home/on-air.ts:20](/home/avoid/Code/avoid-quest/couch/src/client/sections/home/on-air.ts:20), lines 20–42 and 86–99; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/sections/home/on-air.ts#L20-L99).
- **C9 — search presentation:** [local src/client/sections/find/SearchRadioResults.tsx:16](/home/avoid/Code/avoid-quest/couch/src/client/sections/find/SearchRadioResults.tsx:16), lines 16–78; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/sections/find/SearchRadioResults.tsx#L16-L78).
- **C10 — station details:** [local src/client/sections/details/ItemPage.tsx:223](/home/avoid/Code/avoid-quest/couch/src/client/sections/details/ItemPage.tsx:223), lines 223–237; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/sections/details/ItemPage.tsx#L223-L237).
- **C11 — OS metadata and native title:** [local src/client/session/media-session.ts:12](/home/avoid/Code/avoid-quest/couch/src/client/session/media-session.ts:12), lines 12–25 and 46–55; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/session/media-session.ts#L12-L55). [Local src/client/native-window-title.ts:4](/home/avoid/Code/avoid-quest/couch/src/client/native-window-title.ts:4), lines 4–10; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/native-window-title.ts#L4-L10).
- **C12 — Hub integration and single active tracker:** [local src/server/hub.ts:196](/home/avoid/Code/avoid-quest/couch/src/server/hub.ts:196), lines 196, 227, 744–761, 1025, 1156–1165, 1184–1185, 1315–1319; [immutable radio load/setup](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/hub.ts#L1156-L1185), [immutable observer](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/hub.ts#L1025), [immutable delivery](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/hub.ts#L744-L761), [immutable queue intake](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/hub.ts#L1315-L1319).
- **C13 — session publication guards and media load:** [local src/server/session.ts:363](/home/avoid/Code/avoid-quest/couch/src/server/session.ts:363), lines 95, 363–376 and 547–551; [immutable load](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/session.ts#L363-L376), [immutable programme update](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/session.ts#L547-L551).
- **C14 — media delivery/browser renderer:** [local src/server/pass-through.ts:7](/home/avoid/Code/avoid-quest/couch/src/server/pass-through.ts:7), lines 7–21, 62–76, 144–167, 197–218; [immutable preparation](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/pass-through.ts#L144-L167). [Local src/client/session/renderer.ts:8](/home/avoid/Code/avoid-quest/couch/src/client/session/renderer.ts:8), lines 8–15, 64–77, 176–205, 288–315; [immutable renderer](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/session/renderer.ts#L288-L315).
- **C15 — synchronized playback:** [local src/server/sendspin.ts:199](/home/avoid/Code/avoid-quest/couch/src/server/sendspin.ts:199), lines 199–243; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/sendspin.ts#L199-L243). Routing: [local src/server/hub.ts:482](/home/avoid/Code/avoid-quest/couch/src/server/hub.ts:482), lines 482–499; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/hub.ts#L482-L499).
- **C16 — transport, reconnect, and player display:** [local src/client/components/PlaybackTransport.tsx:21](/home/avoid/Code/avoid-quest/couch/src/client/components/PlaybackTransport.tsx:21), lines 21–54 and 62–74; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/components/PlaybackTransport.tsx#L21-L74). [Local src/server/radio-retry.ts:3](/home/avoid/Code/avoid-quest/couch/src/server/radio-retry.ts:3), lines 3–27; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/radio-retry.ts#L3-L27). [Local src/client/sections/now/PlayerPage.tsx:229](/home/avoid/Code/avoid-quest/couch/src/client/sections/now/PlayerPage.tsx:229), lines 229–243 and 302–314; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/sections/now/PlayerPage.tsx#L229-L243).
- **C17 — Home hero:** [local src/client/sections/home/HomePage.tsx:139](/home/avoid/Code/avoid-quest/couch/src/client/sections/home/HomePage.tsx:139), lines 139–175; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/client/sections/home/HomePage.tsx#L139-L175).
- **C18 — duplicated M3U snapshot:** [local src/server/radio-playlists.avoid.m3u:1](/home/avoid/Code/avoid-quest/couch/src/server/radio-playlists.avoid.m3u:1), lines 1–21; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/radio-playlists.avoid.m3u#L1-L21).
- **C19 — mpv metadata boundary:** [local src/server/mpv.ts:9](/home/avoid/Code/avoid-quest/couch/src/server/mpv.ts:9), lines 9–18 and 33–55; [immutable source](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/mpv.ts#L33-L55).

## Provider gaps and recommended priorities

These are recommendations inferred from the traced contracts, not implemented changes.

1. **Freeze exported station identities.** All ten defaults currently omit explicit `id`, so their exported IDs are slugs of names. A cosmetic rename can change a consumer's station identity and metadata lookup. Assign explicit IDs preserving today's exported strings before renaming stations. The helper already supports this, and the README explicitly asks maintainers to retain identity when renaming. [ID generation](../../apps/radio/src/lib/kodi-playlist.ts#L38), [defaults](../../apps/radio/src/lib/const.ts), [README](../../apps/radio/README.md#shared-radio-metadata).
2. **Publish the static fields we already own.** Extend the JSON catalog additively with station `description`, `websiteUrl`, and optional `streamFormat`. Defaults already supply the first two; HKCR explicitly sets HLS. Consider a metadata URL/capability and schema version so consumers do not need an avoid-specific hidden convention. Country/language/codec/quality are separate collection work: the default list does not currently contain verified values for them. [Radio model](../../apps/radio/src/lib/audio/playback/types.ts#L8), [defaults](../../apps/radio/src/lib/const.ts), [projection](../../apps/radio/src/lib/kodi-playlist.ts#L78).
3. **Separate programmes from cache lifetime.** Add nullable programme start/end, episode identity, host/series, live/replay status and next programme where the source provides them; retain existing display fields for compatibility. We already parse schedule boundaries internally for NTS, HKCR, LYL, Airtime, Resonance and Alhara, but mostly reduce them to cache expiry. `sampledAt` and `expiresAt` describe freshness, not a show's full duration, and must not be used as fabricated programme times. A batch now-playing endpoint would also save consumers' per-station fan-out. [Provider adapters](../../apps/radio/src/lib/metadata/external-providers.ts), [LYL adapter](../../apps/radio/src/lib/metadata/lyl-provider.ts), [15-minute cache cap](../../apps/radio/src/lib/metadata/cache.ts#L12).
4. **Export XMLTV if richer stock Kodi integration is a goal.** Build it from verified programme schedules and advertise `x-tvg-url` in the M3U. Do not manufacture a schedule from cache timestamps or imply catch-up playback from `itemUrl`: an episode webpage is not an archive audio URL. This adds guide information to Kodi; Couch's current custom JSON integration already receives rich current-show metadata.
5. **Keep the existing M3U compatible with Couch.** Couch deliberately rejects entire playlists containing `#KODIPROP`, `#EXTVLCOPT`, `#EXTHTTP`, `#WEBPROP` or custom HTTP-header directives. Adding Kodi playback hints to this shared feed would therefore break that consumer. Keep the existing feed simple and put richer application fields in JSON; if per-player directives are necessary, provide a separate opt-in variant. JSON additions will require a corresponding Couch consumer change because Couch currently reads M3U. [Couch parser](https://github.com/avoid-quest/couch/blob/3e603a5a82ee746eaa5e8344a882a493de80b797/src/server/radio-playlists.ts#L27).
6. **Define browser integration explicitly.** Source inspection and live GETs with `Origin: https://couch.avoid.quest` showed no `Access-Control-Allow-Origin` on the catalog and `Access-Control-Allow-Origin: https://radio.avoid.quest` on metadata. Thus ordinary direct browser fetches from Couch's origin cannot read these responses. Server/native consumers can. Couch already fetches via its server, so this is an integration limitation, not a demonstrated Couch failure. Any future browser support should be an explicit origin/session policy change preserving existing request protections. [Origin resolution](../../apps/radio/src/lib/proxy/request-policy.ts#L48), [metadata response headers](../../apps/radio/src/lib/metadata/metadata-workflow.ts#L56), [session/rate-limit registration](../../apps/radio/src/lib/proxy/proxy-route-registration.ts).

## Another local consumer: the Discord bot

The Discord bot does not currently consume these public catalogs for its preset radio command. It keeps eleven entries in [its own preset list](../../apps/discord-bot/src/lib/presets.ts), including Gatto Misterioso, and the [radio command](../../apps/discord-bot/src/commands/radio.ts#L54) creates a live queue item with the station name as title, its static description as artist, and its logo as thumbnail. There is no call to the shared radio metadata endpoint in that command path. Its copied Sygma URL is `audio.ogg` (the radio catalog uses `audio.mp3`), and its two NTS URLs use `stream-relay-geo.ntslive.net` (the radio catalog uses `streams.radiomast.io`). These are confirmed differences, not claims that the alternative streams fail. A richer shared catalog could remove this duplication while allowing bot-specific extra stations; a shared now-playing client could improve its display.

## Provider verification

- Read current source and official Kodi IPTV Simple documentation; compared provider `HEAD` with remote `main` without modifying branches.
- Fetched production M3U and catalog and compared them to `getPublicKodiStations(radios)` / `renderKodiM3uPlaylist(...)` using Bun: exact equality; ten stations.
- Queried all ten station metadata endpoints with `curl`: all returned successful, nonexpired title snapshots. Checked cross-origin response headers separately. An initial Python urllib probe received 403s; curl requests succeeded, so the urllib result was not treated as application or station failure.
- `bun run --filter @avoid.quest/radio test src/lib/kodi-playlist.test.ts`: **5 passed** in this worktree.
- `bun run --filter @avoid.quest/radio test src/lib/kodi-playlist.test.ts src/lib/metadata/metadata-workflow.test.ts src/lib/metadata/radio-config.test.ts`: **16 passed** in `/home/avoid/Code/avoid-quest/avoid.quest`, verified clean at the identical provider SHA. The initial worktree attempt passed five export tests but could not load two suites because this worktree has no installed `@avoid.quest/error` / `zod`; the dependency-installed checkout resolved that limitation.
- No implementation changes, deployments or playback/device testing. Repository-wide `check`, `typecheck`, and app builds were not run because the only repository change is this research document.

## Provider implementation follow-up

Implemented in `research/kodi-couch-metadata`, without changing Couch, committing,
publishing or deploying:

- Default stations now have immutable, full `publicId` values preserving all ten
  previously exported IDs. Unlike the earlier recommendation to populate `id`,
  this deliberately leaves the app's generated local-storage identities and
  name/URL-based seed/sync process untouched. A persisted-library regression
  verifies no rewrites, migrations or duplicate stations.
- `/playlist.m3u` adds only an absolute `x-tvg-url` header pointing to
  `/guide.xml`. Every station line and playback URL matches the original
  playlist byte for byte. XMLTV matches these same channel IDs.
- The existing provider adapters publish a small normalized `RadioProgramme`
  model through an optional callback. Guide retrieval reuses their dispatch,
  enrichment cache and protected upstream fetch path. It skips ICY fallback,
  bounds concurrency/time/bytes/request counts, coalesces concurrent guide
  requests and caches complete or partial exports for five minutes.
- Current/upcoming guide coverage: NTS 1/2, LYL calendar, HKCR schedule/current
  replay, Airtime show blocks (Cashmere/Sygma/IPR), and Resonance. Alhara's track
  duration and BlackOut's undated slot are deliberately not programme windows.
  Upcoming HKCR/LYL details are limited to schedule fields. See the README for
  timezones, the 24-hour start horizon and nullable coverage.
- The JSON response is unchanged, including its envelope, timestamps, field
  meanings, stream binding and middleware. In particular, no large schedule
  array was added: Couch's existing validator reads at most 64 KiB per JSON
  response, so even otherwise ignored additive fields could break compatibility.
  The normalized schedule is exported separately as XMLTV. The catalog JSON
  also retains its existing shape.

Implementation verification in this dependency-installed worktree:

- `bun install --frozen-lockfile` succeeded; no lockfile or dependency changes.
- `bun run check` passed. `bun run typecheck` passed all six workspaces.
- `bun run --filter @avoid.quest/radio build` passed, including the lazy-chunk
  checks. TanStack's normal build generated the new route-tree entry. No
  Cloudflare binding/type change required `cf-typegen`.
- Focused regression command: `bun run --filter @avoid.quest/radio test
  src/lib/kodi-playlist.test.ts src/lib/xmltv.test.ts
  src/lib/metadata/programmes.test.ts src/lib/metadata/guide.test.ts
  src/lib/metadata/metadata-workflow.test.ts
  src/lib/metadata/external-providers.test.ts
  src/lib/metadata/lyl-provider.test.ts src/lib/collections/radios.test.ts`:
  **183 passed**, including old JSON fields, immutable identity, persisted
  library preservation, XML escaping, dated boundaries/DST, invalid entries,
  provider failures, deadlines/concurrency, body-size cancellation and private
  redirect rejection.
- Full `bun run --filter @avoid.quest/radio test` was run twice. The final run
  had **3533 passed, 1 failed**: the existing
  `src/components/radio/dj/deck/deck-progress-isolation.test.tsx:100` assertion
  expected transport render commits to increase but received 2 before and
  after. That test passes alone and alongside `use-track-progress.test.tsx`
  (four tests passed). The full-suite interaction remains unresolved; no DJ
  production code or test was modified for this provider task.
- A live source-level guide retrieval returned **10 channels and 52 real
  programme slots across eight stations in 5.5 seconds**. This is one snapshot,
  not an availability guarantee. The resulting document passed **libxml2 DTD
  validation against the upstream XMLTV `xmltv.dtd`**. DOM tests additionally
  cover escaped XML/control characters and channel/programme ID alignment.
- A read-only mocked probe imported unmodified Couch `readRadioPlaylist` and
  `createRadioMetadata` from the inspected checkout. The final generated M3U
  parsed deep-equal to the original generated M3U: the same ten station
  records, Couch IDs, tvgIds, names, order, logos and playback URLs. The actual
  final provider JSON workflow response was accepted with its existing title,
  description, genre and freshness timestamps; a mismatched stream still
  returned no metadata. No Couch source/data was changed.

No actual Kodi/device playback, installed Couch UI, deployed Worker behavior or
Sentry source-map upload was tested. The build reported the existing missing
Sentry upload credentials; local build success does not claim an upload.

Built Worker HTTP smoke verification also passed using local Vite/Cloudflare
preview: `/playlist.m3u` and `/guide.xml` returned HTTP 200 with the expected
MIME types and bounded cache headers, with no guide session cookie. The actual
playlist route retained all station lines and advertised its absolute local
`/guide.xml` URL. The guide contained **10 channels and 54 programmes** at this
later sample and passed XMLTV DTD validation. A guide request containing an
arbitrary `url` query parameter matched the subsequent parameter-free cached
export exactly. The local preview was stopped after verification.

Changed implementation files (relative to `apps/radio`):

- Catalog identity/discovery: `src/lib/audio/playback/types.ts`,
  `src/lib/const.ts`, `src/lib/kodi-playlist.ts`,
  `src/routes/playlist[.]m3u.ts`.
- Programme adapters/export: `src/lib/metadata/programmes.ts`,
  `src/lib/metadata/external-providers.ts`, `src/lib/metadata/lyl-provider.ts`,
  `src/lib/metadata/retrieval.ts`, `src/lib/metadata/guide.ts`,
  `src/lib/xmltv.ts`, `src/routes/guide[.]xml.ts`, and the normally generated
  `src/routeTree.gen.ts`.
- Tests: `src/lib/kodi-playlist.test.ts`, `src/lib/xmltv.test.ts`,
  `src/lib/collections/radios.test.ts`,
  `src/lib/metadata/metadata-workflow.test.ts`,
  `src/lib/metadata/programmes.test.ts`, `src/lib/metadata/guide.test.ts`.
- Documentation: `README.md` and this preserved/extended audit report.

## Parent review and baseline verification

Reviewed the complete implementation diff, new guide/programme/XMLTV modules,
provider adapters, compatibility regressions, and client documentation. No
additional implementation blockers were found. The existing JSON interface
and original station entries remain intact; the XMLTV export contains no
Couch-specific behavior.

Re-ran `bun run --filter @avoid.quest/radio test` in this worktree: **3533
passed, 1 failed**, with the same DJ progress-isolation assertion reported by
the implementation agent. Then ran the identical command in the clean main
checkout `/home/avoid/Code/avoid-quest/avoid.quest`, verified at the unchanged
baseline `169d0960b08dc682c748c4ef0a7f4637cf621c96`: **3512 passed, 1 failed**.
Both failures are `deck-progress-isolation.test.tsx:100`, expected transport
render count greater than 2, received 2. The baseline remained clean. This
establishes that the failing full-suite assertion predates this change; its
underlying DJ suite interaction is outside this provider implementation and
remains unresolved. The full suite is not reported as passing.

Independently revalidated the saved live guide with system libxml2 against
`xmltv.dtd`: **10 channels, 52 programmes, valid XMLTV**. `git diff --check`
passed. Implementation-agent check/typecheck/build/focused-test and built
Worker HTTP evidence above remains applicable; no implementation edits were
made during parent review. Actual Kodi/Couch device playback remains untested.
