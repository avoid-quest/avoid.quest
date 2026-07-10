# Public YouTube provider research

**Observed:** API sweep 2026-07-10 09:27-09:47 UTC (11:27-11:47 CEST); Chrome DJ-mode follow-up later the same day

**Target:** browser-side YouTube search and audio playback in avoid.quest DJ mode

**Network:** one European egress, with browser-origin headers for `https://radio.avoid.quest`

## Verdict

The earlier empty-allowlist conclusion was too pessimistic. The current official registries are not a complete picture of the public services that are alive today.

Wireway passed the complete, unmodified avoid.quest DJ-mode path. Omada also
played successfully after the public-URL length cap was raised from 2048 to the
adopted 4096-character limit.

The final product selection keeps every provider that passed current-video audio and browser-media checks, ordered by operational confidence:

```ts
[
  {
    id: "piped-wireway",
    kind: "piped",
    baseUrl: "https://pipedapi.wireway.ch",
  },
  {
    id: "invidious-omada",
    kind: "invidious",
    baseUrl: "https://yt.omada.cafe",
  },
  {
    id: "invidious-nikkosphere",
    kind: "invidious",
    baseUrl: "https://invidious.nikkosphere.com",
  },
  {
    id: "invidious-y-com-sb",
    kind: "invidious",
    baseUrl: "https://y.com.sb",
  },
]
```

**All four technically passing providers ship, with weaker/unproven instances
last.** Because none is official or SLA-backed, the product prioritizes
availability through a curated, release-tested failover pool. Supporting Omada
and Nikkosphere requires the reviewed 4096-character URL safety cap documented
below.

- **Immediate technical verdict: Wireway can ship in the current code.** It resolved current and stable videos, passed the repository adapter unchanged, served ranged audio, supplied browser CORS, and played through the real DJ deck.
- **Second provider: Omada with the reviewed 4096-character public-URL cap.** Omada's legitimate signed `/videoplayback` URL for the Chrome-selected 69:43 track exceeded the prior 2048-character `MAX_PUBLIC_HTTP_URL_LENGTH`, so that code rejected an otherwise valid media URL. Raising the cap to 4096 made the same deck workflow play successfully.
- **Last-resort providers: Nikkosphere, then `y.com.sb`.** Both passed current resolution and media checks, but Nikkosphere lacks operator evidence and `y.com.sb` is historically erratic. Keeping them last gives users another path without treating them as equally reliable.
- **Operational verdict: ask Wireway before making its infrastructure a default for all avoid.quest users.** Public availability is not the same as consent to become another product's backend. Wireway describes its services as free to use and permits commercial use subject to its anti-abuse rules; Omada explicitly offers Invidious without an account but warns that demand and YouTube blocking can cause downtime if it is considered later ([Wireway](https://wireway.ch/), [Wireway terms](https://wireway.ch/terms), [Omada Invidious](https://omada.cafe/services/youtube)).
- Do **not** ship the remaining candidates below. They work only for cached fixtures, are metadata-only, or fail the current-video media contract.

This is still third-party volunteer infrastructure. A hard-coded provider is easy to maintain only if a release check exercises playback, and a red provider is removed quickly.

## What was actually tested

An endpoint passed only when all of these succeeded:

1. API health or stats endpoint.
2. Search from `Origin: https://radio.avoid.quest`.
3. Resolution of a current search result and known fixtures.
4. A non-empty audio stream list.
5. A small media request with `Range: bytes=0-65535`.
6. `206 Partial Content`, an audio MIME type, and a valid `Content-Range`.
7. `Access-Control-Allow-Origin: *` on API and media responses.
8. A CORS preflight for `Range` on the shortlisted media proxy.
9. The repository's actual `createPipedAdapter` or `createBrowserInvidiousAdapter`, including its schema, URL-safety, timeout, and one-byte media verification.
10. The real Chrome DJ-mode workflow: load the YouTube platform item onto deck A, search inside that deck, select a result, and press play.

No full audio files were downloaded.

Fixtures:

| Purpose | Video ID | Notes |
| --- | --- | --- |
| Current search result | `MOi7m1WtKYc` | Search returned it as a 2026 music result, published one day earlier during this observation. |
| Known 2026 result | `x-1zY4cPOpk` | “The Official FIFA World Cup 26 Theme.” |
| Stable fixture | `dQw4w9WgXcQ` | Commonly cached, so it is useful but insufficient alone. |
| Alternate stable fixture | `jNQXAC9IVRw` | Exposed partial/cache-specific failures on several Invidious instances. |

The relevant response models are the documented Piped `/streams/:id` `audioStreams` collection and Invidious `/api/v1/videos/:id` `adaptiveFormats` collection ([Piped API](https://docs.piped.video/docs/api-documentation/), [Invidious API](https://docs.invidious.io/api/)).

## Chrome DJ-mode validation

The final browser validation used the correct deck-local workflow rather than the unrelated global search box:

1. Load the YouTube platform card onto deck A.
2. Use the search field inside the loaded YouTube deck item.
3. Select a returned track.
4. Press the deck's play control and observe network media type and visible progress.

| Provider | Chrome result |
| --- | --- |
| Wireway | Search `200`; `/streams/BhvEtB5m7yM` `200`; `pipedproxy.wireway.ch` returned a `206` Media response with `audio/webm`; deck progress visibly advanced to `0:04 / 4:24`. No diagnostic code change was needed. |
| Omada | Search and result resolution returned `200`; `yt.omada.cafe/videoplayback` returned a `206` Media response with `audio/webm`; deck progress visibly advanced to `0:03 / 69:43`. This worked only after temporarily changing `MAX_PUBLIC_HTTP_URL_LENGTH` from 2048 to 4096. |

The diagnostic edit was reverted after the browser run. The final integration subsequently adopts the reviewed 4096-character cap with boundary regression tests, so Omada's long signed URLs now pass while over-limit URLs still fail closed. Wireway remains usable unchanged.

A final 12:35 CEST repository-adapter repeat searched `Four Tet`, resolved the
first result, and tested each provider independently in parallel. All four
passed: Wireway returned `pipedproxy.wireway.ch`; Omada returned
`yt.omada.cafe`; Nikkosphere returned `invidious.nikkosphere.com`; and
`y.com.sb` returned its local media host. Nikkosphere and `y.com.sb` did not
receive separate Chrome deck runs, so their evidence remains adapter/media-level
plus the earlier direct range probes.

A later post-integration repeat produced one connection reset from `y.com.sb`,
then an immediate independent repeat passed all four providers again. This is why
`y.com.sb` remains the last reserve rather than being removed or promoted: it is
playback-capable, but materially less dependable than the providers ahead of it.

## Discovery coverage

The sweep intentionally went beyond registry flags:

- The [official Piped static list](https://github.com/TeamPiped/Documentation/blob/main/content/docs/public-instances/index.md) currently names 15 API bases, while the [official live feed](https://piped-instances.kavin.rocks/) currently contains only `api.piped.private.coffee`.
- Historical revisions of the first-party Piped list yielded 54 distinct API bases. The old official wiki specifically listed Wireway as a CDN-backed instance in Switzerland and Germany ([official historical Wireway entry](https://github.com/TeamPiped/Piped/wiki/Instances/f26a1685a1f741d6d7756d47319e064c38f5a404)).
- A current community-maintained candidate corpus supplied 131 Piped bases and 104 Invidious bases. It was used only for discovery and historical probe context; every survivor was probed directly ([Piped candidates](https://github.com/kuru-bana/yt-data/blob/main/piped/data/piped.json), [Invidious candidates](https://github.com/kuru-bana/yt-data/blob/main/invidious/data/invidious.json)).
- The [official Invidious instances API](https://api.invidious.io/instances.json) returned six clearnet HTTPS entries. The official project warns that unlisted instances are untrusted and that its public list is deliberately short because of current YouTube restrictions ([Invidious instance policy](https://docs.invidious.io/instances/)).

First-stage live results:

| Family | Candidates swept | Search/API survivors | Playback survivors |
| --- | ---: | ---: | ---: |
| Piped | 131 | 3 | 1 |
| Invidious | 104, plus the current official feed | 7 search-capable in the community snapshot | 4 returned audio for at least one fixture; 3 returned current audio; 2 are credible defaults |

The large candidate count is real, but most names are dead DNS, invalid TLS, shutdown notices, frontend HTML on an API hostname, or metadata-only deployments.

## Ranked results

### 1. `https://pipedapi.wireway.ch` — ship first

Live results:

| Probe | Result |
| --- | --- |
| `/healthcheck` | `200 OK`, body `OK`, CORS `*` |
| Search | `200`, JSON, 20 results, CORS `*` |
| Current search result | 5 audio streams |
| 2026 fixture | 5 audio streams |
| `dQw4w9WgXcQ` | 5 audio streams |
| `jNQXAC9IVRw` | 5 audio streams |
| Returned media host | `pipedproxy.wireway.ch` |
| Media range | `206`, `audio/webm` or `audio/mp4`, exact `Content-Range`, CORS `*` |
| Range preflight | `200`, allows `GET`, `OPTIONS`, `Range`, and origin `*` |
| Repository adapter | Probe, 20-result search, current result resolution, and media verification passed |
| Chrome DJ deck | `BhvEtB5m7yM` played to `0:04 / 4:24` with the unmodified 2048-character URL cap |

The first current media probe returned:

- `Content-Range: bytes 0-65535/3801586`
- `Content-Length: 65536`
- `Accept-Ranges: bytes`
- `Access-Control-Allow-Origin: *`

The community probe history, updated 2026-07-08, recorded `1576/1635` successful `/streams/:id` checks (96.39%) and `1544/1635` successful search checks (94.43%). These are endpoint-check success ratios, not an SLA and not proof that every successful stream response contained usable audio ([Piped probe statistics](https://github.com/kuru-bana/yt-data/blob/main/piped/data/stats.json)). Unlike Private Coffee, Wireway also passed the content-level audio and range checks today.

Operational evidence is comparatively strong:

- Piped's historical first-party wiki listed the instance and marked it CDN-backed.
- Wireway's own site identifies Piped as one of its free privacy services, provides contact information, and says its infrastructure goal is safe, fast, reliable service ([Wireway](https://wireway.ch/)).
- Its terms allow commercial use while reserving the right to revoke access for abuse ([terms](https://wireway.ch/terms)).
- Wireway publishes operator-maintained forks of the
  [Piped backend](https://git.eplg.services/obvtiger/Piped-Backend),
  [media proxy](https://git.eplg.services/obvtiger/piped-proxy), and
  [NewPipeExtractor](https://git.eplg.services/obvtiger/NewPipeExtractor). The
  extractor package was updated on 2026-06-21, which is stronger maintenance
  evidence than a responsive health endpoint alone.

Caveats:

- It is absent from both Piped's current static list and current live feed.
- `/version` returned `unknown`, so extraction freshness cannot be ranked from that endpoint.
- The operator should confirm that avoid.quest's projected traffic is acceptable.

### 2. `https://yt.omada.cafe` — ship second after the URL-cap change

Live results:

| Probe | Result |
| --- | --- |
| `/api/v1/stats` | `200`; build `2026.07.07-6373ac7` |
| Search | `200`, 20 results, CORS `*` |
| Current search result | 2 audio formats; media `206` |
| 2026 fixture | 4 audio formats; media `206` |
| `dQw4w9WgXcQ` | 4 audio formats; media `206` |
| `jNQXAC9IVRw` | `200` error-shaped response with no audio |
| Returned media host | `yt.omada.cafe` with `local=true` |
| Range preflight | `200`, allows `GET`, `OPTIONS`, `Content-Type`, `Range`, and origin `*` |
| Repository adapter | Shorter signed URLs passed, but a legitimate Chrome-selected URL exceeded the prior 2048-character safety cap |
| Chrome DJ deck | Played to `0:03 / 69:43` only with a temporary 4096-character cap |

Example ranged media results:

- Current search result: `206 audio/webm`, `Content-Range: bytes 0-65535/156347411`
- 2026 fixture: `206 audio/webm`, `Content-Range: bytes 0-65535/2019279`
- Stable fixture: `206 audio/webm`, `Content-Range: bytes 0-65535/3433755`

The community checker recorded `745/772` successful video endpoint checks (96.50%) and `759/772` successful searches (98.32%) in its current statistics. Its 30-day endpoint-coverage history averaged 83/100, with non-zero results in 2626 of 2876 samples ([Invidious probe statistics](https://github.com/kuru-bana/yt-data/blob/main/invidious/data/stats.json), [availability history](https://github.com/kuru-bana/yt-data/blob/main/invidious/data/availability_history.json)).

Omada is unusually transparent for an unlisted instance:

- It describes itself as a privacy-first community operating free/open-source services since 2021 ([Omada](https://omada.cafe/)).
- Its Invidious page says no account is required, documents the main instance, and explicitly warns that demand and YouTube blocking may cause occasional downtime ([service page](https://omada.cafe/services/youtube)).

Caveats:

- It is absent from the current official Invidious list, whose maintainers tell users to treat unlisted instances as untrusted.
- The alternate `npyt.omada.cafe` instance advertised as a reliability fallback returned `502` for search and video APIs during this observation. It is not an avoid.quest fallback today.
- The prior `MAX_PUBLIC_HTTP_URL_LENGTH = 2048` rejected at least one legitimate Omada signed URL. The final integration raises it to 4096 with regression coverage for the allowed boundary and continued over-limit rejection.

### 3. `https://invidious.nikkosphere.com` — ship third, monitor closely

Current behavior was excellent:

- Build `2026.07.07-6373ac7`.
- Search returned 20 items with CORS `*`.
- A current search result, the 2026 fixture, and `dQw4w9WgXcQ` returned 2-4 audio formats.
- All three selected media URLs returned `206`, correct audio MIME types, exact ranges, and CORS `*`.
- The real repository adapter passed three current/stable resolutions on repeat.

Why it remains below Wireway and Omada:

- It has no current official listing and no discoverable operator policy/contact evidence comparable to Wireway or Omada.
- The community checker recorded `0/772` successes from its own egress even though this direct European probe succeeded. That mismatch could mean bot/IP filtering, a very recent recovery, or monitoring incompatibility; none is reassuring for a global default ([statistics](https://github.com/kuru-bana/yt-data/blob/main/invidious/data/stats.json)).
- One initial end-to-end adapter run hit an unsafe-media-url result before repeats passed; its cause was not isolated, so this remains additional evidence against promoting the instance now.

The product's availability policy includes it as the third provider, while repeated checks from multiple regions and operator acknowledgement remain required maintenance work.

### 4. `https://y.com.sb` — ship last because it is erratic

The instance is real and capable:

- Build `2026.06.27-ad0bd92`.
- It resolved current and stable videos into 2-4 local audio formats.
- Media returned `206`, `Content-Range`, `Access-Control-Allow-Origin: *`, and correct audio MIME types.
- The repository adapter passed a current search and resolution.
- It appeared in an older first-party Invidious list ([historical official documentation](https://gitea.it/iv-org/documentation/src/commit/1788c0b58967ae117d82d21ce61aaff6c452cd80/docs/instances.md)).

However, repeated requests also produced empty replies, HTTP/2 framing failures, TLS connection errors, and a transient socket failure. The community checker recorded only `188/772` successful video checks (24.35%) and `236/772` successful searches (30.57%) ([statistics](https://github.com/kuru-bana/yt-data/blob/main/invidious/data/stats.json)).

Verdict: include it only as the last automatic fallback and keep the short timeout/error path observable; remove it if the historical failure rate persists without useful recoveries.

### 5. `https://invidious.schenkel.eti.br` — cached fixture only

- Search worked.
- `dQw4w9WgXcQ` returned 4 audio formats and ranged media worked.
- Current search and 2026 fixtures returned `500` with “content isn't available” or YouTube community-protection errors.
- The alternate stable fixture also failed.

This is exactly the cached-fixture trap. The instance's official addition thread records that it was removed for slow/non-responsive behavior and was not re-added without stronger traffic mitigation ([Invidious documentation issue #607](https://github.com/iv-org/documentation/issues/607)).

Verdict: no ship.

### Piped metadata-only survivors — no ship

#### `https://api.piped.private.coffee`

- It is the only entry in the current official live feed.
- Health and search returned `200` with CORS `*`.
- A fresh search result returned `500 LOGIN_REQUIRED` in one run.
- The 2026 fixture and stable fixtures later returned cached `200` metadata but **zero `audioStreams`**.
- The repeated 2026 probe was consistently `200` with zero audio.

The community status checker recorded `1635/1635` successful `/streams` checks, proving why status/schema-only monitoring is insufficient: today's cached response still had no playable audio ([statistics](https://github.com/kuru-bana/yt-data/blob/main/piped/data/stats.json)).

#### `https://pipedapi.winscloud.net`

- Search returned `200`, 20 results, and CORS `*`.
- Every tested `/streams/:id` resolution failed with `ANDROID player response is not valid`, or timed out.
- The community checker recorded `0/1635` successful stream checks despite high success on metadata endpoints ([statistics](https://github.com/kuru-bana/yt-data/blob/main/piped/data/stats.json)).

Verdict for both: metadata/search availability does not make them playback relays.

## NewPipe and other alternative stacks

NewPipe and PipePipe do not expose public relay URLs. Their extractor projects
are embedded Java libraries: the host application supplies networking, and the
extractor returns upstream media URLs. A browser port would still face upstream
CORS, PO-token, IP-binding, and byte-relay requirements. Hosting either library
inside avoid.quest would restore the server-side resolver responsibility this
change removes ([NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor),
[PipePipeExtractor](https://github.com/InfinityLoop1308/PipePipeExtractor)).

Piped is the practical hosted NewPipeExtractor stack. Wireway passed because its
operator maintains the extractor, backend, and media proxy together; there is
no useful third `newpipe` provider kind to add.

Other families did not improve the shortlist:

| Family | Finding |
| --- | --- |
| Wireway RePiped | Same-origin WebSocket/media design without the cross-origin browser contract required here. |
| Cobalt | Hosted APIs require authorization or explicit operator coordination; public probes did not provide an anonymous playback path. |
| NewLeaf / public yt-dlp APIs | Search sometimes worked, but current video extraction hit YouTube bot confirmation or returned direct Google media without a durable relay. |
| PokeTube / Materialious | Public endpoints were unavailable, origin-restricted, authentication-gated, or lacked media CORS. |
| Hyprepipe / metadata frontends | Search and browse metadata only; playback still depends on Piped or another relay. |

These alternatives remain self-hosting or negotiated-service options, not
maintainable anonymous defaults.

## Current official registries

### Invidious

At 2026-07-10 09:42 UTC, every clearnet HTTPS base in the official API failed playback:

| Base | Search | Current video with `local=true` |
| --- | --- | --- |
| `inv.nadeko.net` | `403`, endpoint disabled | `403`, endpoint disabled |
| `invidious.nerdvpn.de` | `401` | `401` |
| `invidious.f5.si` | `403` | `403` |
| `inv.zoomerville.com` | `200`, CORS `*` | `403` |
| `yt.chocolatemoo53.com` | `200`, CORS `*` | `403`, no CORS |
| `invidious.tiekoetter.com` | `403` | `403` |

The official registry's `api` and `cors` flags are based on shallow API checks and cannot establish video playback. The instances API implementation is public ([instances-api source](https://github.com/iv-org/instances-api)).

### Piped

The 15 current static-list bases reduced as follows:

- `api.piped.private.coffee`: valid health/search, but no current playable audio.
- `pipedapi.kavin.rocks`, `pipedapi-libre.kavin.rocks`, `pipedapi.leptons.xyz`, `pipedapi.reallyaweso.me`: `502`.
- `pipedapi.orangenet.cc`: frontend HTML rather than API JSON.
- `pipedapi.drgns.space`, `pipedapi.ducks.party`: timed out.
- The remaining static entries failed DNS, TLS, or connection checks from this egress.

The Piped documentation itself warns that hosted instances on the page are not checked for correct configuration ([public instances](https://github.com/TeamPiped/Documentation/blob/main/content/docs/public-instances/index.md)).

## Failure classification

| Failure | Examples | Meaning for avoid.quest |
| --- | --- | --- |
| Dead/unroutable | DNS, TLS, refused connection, timeout | Remove immediately. |
| Human-only protection | `401`, `403`, Cloudflare/Anubis page | Not usable by a browser API client. |
| API deliberately disabled | Nadeko family | Not a candidate even if the website plays. |
| Metadata-only | Winscloud | Search can populate UI, but deck loading fails. |
| Login/not-bot restriction | Private Coffee fresh resolution | YouTube blocked the extractor egress. |
| Cached success without audio | Private Coffee stable fixtures | HTTP `200` is a false positive. |
| Cached fixture only | Schenkel | A famous fixture passes while a fresh result fails. |
| Regional/transient transport | `y.com.sb` | Keep it last and bound each attempt with a short deadline. |
| Partial video-specific extraction | Omada/Nikkosphere `jNQXAC9IVRw` | Fail over per video; do not mark the whole provider permanently dead from one ID. |

No login-required candidate is recommended. No geoblock was observed on the two shortlisted 2026 media fixtures, and both served bytes from the European probe. That does not guarantee every licensed video in every country.

## Smallest maintenance model

1. Keep the four hard-coded providers in the measured order above. Do not restore custom provider URLs.
2. Keep `MAX_PUBLIC_HTTP_URL_LENGTH` at 4096 with regression tests for legitimate long signed media URLs, continued rejection above the limit, and preservation of the existing protocol, credential, internal-address, and redirect checks.
3. Re-resolve the canonical video ID through each provider independently whenever a fresh media URL is needed; never persist signed media URLs as identity or pass one provider's signed URL to another.
4. Fail over on no-audio, invalid schema, CORS, timeout, or HTTP errors; fail plainly only after every curated provider fails.
5. Do not add a server-side audio proxy. Every selected provider returns browser-playable proxied media.
6. Run a release conformance check against:
   - a search result uploaded in the last seven days;
   - one stable fixture;
   - non-empty audio;
   - repository adapter resolution;
   - ranged media bytes and CORS;
   - the real Chrome deck-local search, selection, playback, and visible progress path;
   - a signed URL longer than 2048 characters when Omada is present.
7. Do not use `dQw4w9WgXcQ` alone. Private Coffee and Schenkel demonstrate that cached fixtures create false confidence.
8. Contact `contact@wireway.ch` and Omada's administrators before enabling material production traffic; keep monitoring Nikkosphere and `y.com.sb` while seeking operator provenance ([Wireway contact](https://wireway.ch/), [Omada contact](https://omada.cafe/contact/)).

## Reproducibility notes

Representative API probes used headers equivalent to:

```sh
curl \
  -H 'Origin: https://radio.avoid.quest' \
  -H 'Accept: application/json' \
  'https://pipedapi.wireway.ch/streams/x-1zY4cPOpk'

curl \
  -H 'Origin: https://radio.avoid.quest' \
  -H 'Accept: application/json' \
  'https://yt.omada.cafe/api/v1/videos/x-1zY4cPOpk?local=true'
```

Media probes requested only the first 65,536 bytes and inspected status and headers. CORS preflight used `Access-Control-Request-Method: GET` and `Access-Control-Request-Headers: range`.

Public-instance state can change within minutes. The direct observations in this report are a release snapshot, while community historical ratios are supporting context rather than promises from the operators.
