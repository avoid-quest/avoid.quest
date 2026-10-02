# Mixcloud anonymous stream research

Probe date: **2026-10-01**, about 10:25–10:40 UTC. Probes ran from one
residential IP in Italy with `curl` and `bun`, with no account, cookies or API
key.

## Verdict

- Public shows ("cloudcasts") resolve anonymously to real audio. Two stream
  forms are offered, and both return audio bytes:
  - **Progressive M4A** (`streamInfo.url`) on `dl.mixcloud.stream`: AAC in an
    MP4 container, 64 kbps. It needs the `?sig=` query, and returns `403`
    without it or with a forged one.
  - **HLS** (`streamInfo.hlsUrl`) on `aod.mixcloud.stream`: a VOD master
    playlist with AAC `.ts` segments of about 10 s. Recent uploads also carry a
    192 kbps variant, which the progressive file does not have. HLS URLs carry
    no signature.
- **CORS:** both stream hosts send `Access-Control-Allow-Origin: *` on `GET`.
  `aod.mixcloud.stream` also answers preflights (`allow-headers: *`, and it
  exposes `Content-Range`). `dl.mixcloud.stream` answers `OPTIONS` with `405`.
  Media-element range requests and safelisted `Range` values are not
  preflighted, so this does not matter for `<audio crossorigin>`.
- **Range:** `dl.mixcloud.stream` returns `206` with a correct
  `Content-Range` for both start and mid-file ranges. Mid-file throughput was
  about 300 KB/s, roughly 37 times real time at 64 kbps.
- **Relay:** none needed. Unlike Bandcamp's `bcbits.com`, the browser can
  fetch both stream forms directly from `https://radio.avoid.quest`.
- **Resolution must run server-side.** `app.mixcloud.com/graphql` sends no
  `Access-Control-Allow-Origin` for `https://radio.avoid.quest`.
  `api.mixcloud.com`, which serves search, does allow that origin.
- **Expiry:** the progressive `sig` was identical across repeated lookups, and
  responses send `Expires: 2037` with `max-age=315360000`. That looks like a
  static, path-bound signature rather than a short-lived token. **Not
  verified:** whether the `sig` is bound to the resolving IP. A second vantage
  point was unavailable. HLS has no token at all.

## Endpoints

### Metadata and search: `https://api.mixcloud.com/` (REST, keyless)

`GET /search/?q=gilles+peterson&type=cloudcast&limit=2` returns
`{ data: [{ key, url, name, audio_length, pictures{…}, user{name, username}, … }] }`.
`fixtures/search-cloudcast.json` holds this response, trimmed to one tag per
result.

`GET /dholbach/cryptkeeper/` returns the same cloudcast shape with
`audio_length: 3723`. It carries no stream URLs.

### Stream: `https://app.mixcloud.com/graphql`

This follows yt-dlp's `yt_dlp/extractor/mixcloud.py` (master, read on
2026-10-01). Both `GET ?query=…` and `POST {query, variables}` work without
cookies; `getMixcloudItem` uses POST with a `$lookup: CloudcastLookup!`
variable. The response sets an anonymous `mx_t` cookie, which is not needed
afterwards.

```text
query ($lookup: CloudcastLookup!) {
  cloudcastLookup(lookup: $lookup) {
    name audioLength isExclusive restrictedReason
    owner { displayName username }
    picture(width: 1024, height: 1024) { url }
    streamInfo { url hlsUrl dashUrl }
  }
}
```

The `streamInfo` fields are base64 encoded and XOR-ed with
`IFYOUWANTTHEARTISTSTOGETPAIDDONOTDOWNLOADFROMMIXCLOUD`. Here is the decoded
output for `dholbach/cryptkeeper`, recorded in
`fixtures/cloudcast-cryptkeeper.json`:

```text
url     https://dl.mixcloud.stream/secure/c/m4a/64/6/f/c/d/d610-b93d-40e5-9086-d731038019d9.m4a?sig=ZoVzO9AXXMDKP4gxB6y3uQ
hlsUrl  https://aod.mixcloud.stream/secure/hls/6/f/c/d/d610-b93d-40e5-9086-d731038019d9.m4a/index.m3u8
dashUrl https://aod.mixcloud.stream/secure/dash2/6/f/c/d/d610-b93d-40e5-9086-d731038019d9.m4a/manifest.mpd
```

Progressive `GET` with `Origin: https://radio.avoid.quest` and
`Range: bytes=0-65535`:

```text
HTTP/2 206
content-type: audio/mpeg            <- mislabelled; the bytes are MP4 ("ftypM4A ")
content-range: bytes 0-65535/32020480
access-control-allow-origin: *
expires: Thu, 31 Dec 2037 23:55:55 GMT
```

Newer uploads are served as `audio/mp4`. For example, NTS shows have
`content-type: audio/mp4`, an `ftypM4A` box and a `…-192K,.m4a.urlset`
HLS master.

HLS master, variant and segment requests each returned `200` with
`access-control-allow-origin: *`,
`access-control-allow-methods: GET, HEAD, OPTIONS` and
`access-control-expose-headers: Server,range,Content-Length,Content-Range`.
The segment was `video/MP2T` and started with the `0x47` sync byte.

## Failure modes

| Response                                     | Meaning                                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| `cloudcastLookup: null`                      | No such show (`fixtures/cloudcast-not-found.json`)          |
| `restrictedReason: "tracklist"`, no streams  | Region-locked for licensing (`fixtures/cloudcast-restricted-tracklist.json`); seen on `AuxiliaryMixes/fred-again-boiler-room-london` from Italy |
| `restrictedReason: "repeat_play"`            | Play limit reached (from yt-dlp; not observed)              |
| `isExclusive: true` with no streams          | Mixcloud Select subscriber-only (from yt-dlp; not observed) |

Licensing restrictions depend on the resolving server's region. A Cloudflare
Worker resolves from a different region than the listener, so the same show
can be playable for one and restricted for the other.
