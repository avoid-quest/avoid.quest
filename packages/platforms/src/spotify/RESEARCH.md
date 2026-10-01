# Spotify anonymous metadata and mirror research

Probe date: **2026-10-01**, about 10:30–11:00 UTC. Probes ran from one
residential IP in Italy with `curl` and `bun`, with no account, cookies,
client credentials or API key.

## Verdict

- **Audio never comes from Spotify.** Full tracks are Widevine-protected. The
  module plays a **mirror**: Spotify metadata, YouTube audio, as LavaSrc and
  spotDL do. The `audioPreview` 30-second MP3s are not used.
- **Metadata:** the public embed page
  `https://open.spotify.com/embed/<track|album|playlist>/<id>` carries the
  full item as JSON in `<script id="__NEXT_DATA__">`. It is the only source
  the module needs. Individual track embeds do not provide an album name.
- **Short links:** `spotify.link/<code>` resolves through Branch.io
  (`spotify.app.link`), server-side only.
- **Search: not supported. Spotify is pasted-link only.** An anonymous search
  path works today, but it rides a shared quota that was already exhausted for
  every other endpoint during the probe (evidence below).
- **CORS:** the embed and track pages send no `Access-Control-Allow-Origin`,
  so metadata resolution must run on the server. oEmbed sends
  `access-control-allow-origin: *` but has no artists, duration or tracks.

## Metadata

### Embed page (used)

`GET https://open.spotify.com/embed/track/2Foc5Q5nqNiosCNqttzHof` returns
`200 text/html`, about 11 KB in about 100–400 ms, with no special headers.
`props.pageProps.state.data.entity`, trimmed:

```json
{
  "type": "track",
  "id": "2Foc5Q5nqNiosCNqttzHof",
  "name": "Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]",
  "artists": [
    { "name": "Daft Punk" },
    { "name": "Pharrell Williams" },
    { "name": "Nile Rodgers" }
  ],
  "duration": 247632,
  "isPlayable": true,
  "visualIdentity": { "image": [{ "url": "…ab67616d0000b273…", "maxWidth": 640 }] }
}
```

Album and playlist entities have `name`, `subtitle` (album artist or playlist
owner), artwork (`visualIdentity.image` for albums, `coverArt.sources` for
playlists), and a `trackList`:

```json
{
  "uri": "spotify:track:0DiWol3AO6WpXZgp0goxAV",
  "title": "One More Time",
  "subtitle": "Daft Punk",
  "duration": 320357,
  "isPlayable": true,
  "entityType": "track"
}
```

- Durations are milliseconds.
- Track-list artists are a single `subtitle` string joined with `", "`, for
  example `"Justin Bieber, Nicki Minaj"`. Only a track embed lists artists
  separately.
- **No ISRC** anywhere in the embed, oEmbed or track page. Matching cannot use
  it.
- **Track counts:** _Discovery_ listed all 14 tracks and the 30-track user
  playlist `432nsnOM9L55tkiOFnHbI2` listed all 30. _Today's Top Hits_ listed
  50 and _All Out 2010s_ listed **100**, which is the embed's cap. Larger
  playlists are truncated to their first 100 tracks.
- An unknown id still returns `200`, with `pageProps: { status: 404 }` and no
  `state`.
- Artist embeds return the artist's top 10 tracks. They are not supported.

Recorded fixtures are in `fixtures/embed-*.html`; the access token is redacted
and track lists are cut to a few entries.

### Track page (not used)

`GET https://open.spotify.com/track/<id>` (about 270 KB) has
`og:description` in the form `<artists> · <track title> · Song · <year>` when
requested with `accept-language: en`. The recorded Get Lucky page repeats its
`og:title` in the second segment; it does not provide the album name. It also
has `music:duration`, `music:album` (a URL only) and `music:release_date`.
Individual track links therefore leave the album name unknown. Album embeds
provide the album name for their own tracks. See
`fixtures/track-page-get-lucky.html`.

### oEmbed (not used)

`GET https://open.spotify.com/oembed?url=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT`
returns `title`, `thumbnail_url` and an iframe snippet, with no artist,
duration or track list.

## Short links and URIs

- `spotify.link/6tpneu0iVIb` → `307` to
  `spotify.app.link/6tpneu0iVIb?_p=…`. With `_p`, `spotify.app.link` serves a
  `200` landing page whose links and `window.top.location` point to
  `https://open.spotify.com/playlist/432nsnOM9L55tkiOFnHbI2?si=…`. Without
  `_p`, it sends a `307` straight to that URL. The resolver handles both.
- Expired or unknown codes redirect to `https://open.spotify.com/` or to an
  App Store landing page. Both are reported as "does not point to a track,
  album or playlist". `spotify.link/h5TbcGLLkhb` and `spotify.link/T1vKH6Kr9ib`
  behaved this way.
- `spotify:track:<id>`, `spotify:album:<id>`, `spotify:playlist:<id>` and the
  legacy `spotify:user:<user>:playlist:<id>` are parsed locally, as are
  `/intl-xx/` prefixes, `/embed/` paths and `?si=` parameters.

## Search verdict: pasted links only

The embed page's `state.settings.session` holds an anonymous Web API token
(`isAnonymous: true`, client id `ab9ad0d96a624805a7d51e8868df1f97`, about
15 minutes of validity). With it:

| Request (same anonymous token)                          | Result                                                   |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `GET api.spotify.com/v1/search?q=…&type=track&limit=3`  | `200`, 6 requests in a row; includes `external_ids.isrc` |
| `GET /v1/search?type=album` and `type=playlist`         | `200`                                                    |
| `GET /v1/tracks/<id>`, `/v1/tracks?ids=…`               | `429 QUOTA_EXCEEDED`, `retry-after: 80724` (22.4 h)      |
| `GET /v1/albums/<id>`, `/v1/albums/<id>/tracks`         | `429 QUOTA_EXCEEDED`, same `retry-after`                 |
| `GET /v1/playlists/<id>`, `/v1/artists/<id>`            | `429 QUOTA_EXCEEDED`, same `retry-after`                 |
| Fresh token from another embed page, `/v1/tracks/<id>`  | `429 QUOTA_EXCEEDED` (the quota is per client, not token) |
| Search `total` for one query                            | 17, 21 and 29 on consecutive pages (inconsistent)         |

The quota belongs to Spotify's own embed client and is shared by everyone who
scrapes that token. It was exhausted for nearly a day on every metadata
endpoint during the probe, so search sits one quota bucket from the same
failure. The pathfinder GraphQL (`api-partner.spotify.com`, `searchDesktop`)
also answered with that token, but it depends on a persisted-query hash that
changes with web-player releases. Neither is reliable enough to ship, so
Spotify has no search adapter: users paste links.

## Mirror (YouTube) matching

The module takes a `SpotifyYouTubeSource` (`search` plus `resolveStream`); a
`YouTubeClient` fits it. Live search on 2026-10-01 through the radio app's
curated pool (`pipedapi.wireway.ch`, `yt.omada.cafe`,
`invidious.nikkosphere.com`) found the right upload within 1–2 s:

- Piped `filter=music_songs` returns YouTube Music art tracks, authored by
  the artist. Their durations match Spotify to the second, for example
  `Rgrt_8mXrK8` "Get Lucky (Radio Edit - feat. …)", 249 s against 247.6 s.
- Invidious ignores the filter and returns videos: official video, official
  audio, lyric re-uploads and live versions.
- One best song match (`10OaW3O429k`, Rahill "Tell Me") failed to stream on
  every provider, while the official video streamed. Hence the second search
  over videos.

`fixtures/youtube-search.json` records these results for the match tests.

Matched stream URLs are `…/videoplayback?expire=<now + 6 h>&…` behind the
provider host, so they expire after about six hours.
