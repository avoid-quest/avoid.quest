# Bandcamp relay research

Research date: **2026-07-10** (Europe/Rome; live probes between 09:27 and
09:56 UTC)

Rechecked: **2026-10-07**. The July byte measurements below are historical;
`proxy.cors.sh` and `cors.zme.ink` now return NXDOMAIN and have been removed.
`seep.eu.org` is the only shipped relay, and its deployed implementation is now
a Go rewrite rather than the Node source inspected in July.

## Decision

Three anonymous public URL prefixes passed the Bandcamp byte contract in July.
Only one remains in the shared metadata/browser relay list:

```text
https://seep.eu.org/<fresh-bcbits-stream-url>
```

In July, all three returned real MP3 bytes, preserved exact
`206 Partial Content` range semantics, returned `audio/mpeg`, and allowed
`https://radio.avoid.quest` with
`Access-Control-Allow-Origin: *`. Both Netnr endpoints returned complete exact
5,605,667-byte and 8,408,365-byte files, two isolated ranges, and six concurrent
disjoint ranges. CORS.SH passed the same core checks plus ten concurrent ranges
and an open-ended range. All three passed a production-origin `Range` preflight,
and complete-file SHA-256 hashes matched direct upstream downloads.

The current dispositions are:

1. **`seep.eu.org` — selected primary.** It is the public URL in the
   inspected Netnr README, and the operator's service page labels it unrestricted.
2. **`proxy.cors.sh` — dead (NXDOMAIN), removed.** Its July anonymous media
   pass and Chrome playback result no longer make it a usable fallback.
3. **`cors.zme.ink` — dead (NXDOMAIN), removed.** Its July
   `x-release: Netnr/10.0.8` matched seep; it never provided independent redundancy.

The browser probes seep under one five-second deadline and consumes an actual
media byte before playback. There is no second provider if seep fails. Netnr
publishes public usage but offers no availability promise. The July Node source
had no application-level rate, timeout, or response-size cap; those source
observations do not establish the Go deployment's limits. Historical sources:
[Netnr proxy README at the tested revision](https://github.com/netnr/proxy/blob/72163906423daa0712cb5036a455879c061618b6/README.md#L1-L27),
[operator service page](https://netnr.com/134), and [streaming proxy
implementation](https://github.com/netnr/proxy/blob/72163906423daa0712cb5036a455879c061618b6/app.js#L30-L116).

CORS.SH's July service spec retained an anonymous tier at 30 requests per
10 seconds per IP, while its public API documentation required an API key.
The same source recorded unresolved provider-AUP, observability, and legal/ToS
work. Its published contract said 6 MB per request while the July deployment
allowed the larger probe. See [CORS.SH's committed service spec at the tested
revision](https://github.com/gridaco/cors.sh/blob/f64fa2d38a4494b94bfaf54383d51a38c7794209/SPEC.md#L11-L26),
[its anonymous-tier policy](https://github.com/gridaco/cors.sh/blob/f64fa2d38a4494b94bfaf54383d51a38c7794209/SPEC.md#L77-L101),
and [its inspected proxy implementation](https://github.com/gridaco/cors.sh/blob/f64fa2d38a4494b94bfaf54383d51a38c7794209/workers/proxy/src/index.ts#L13-L97).

No Tent instance is usable by the current DJ audio graph. Seven of the eleven
listed clearnet instances did relay the complete MP3, but every one omitted
CORS, ignored `Range`, returned `200` and the whole file, and usually labeled
it `application/octet-stream`. Four other instances were blocked or broken.

One further demo (`test.cors.workers.dev`) technically passed, but its operator
explicitly forbids demo use beyond testing, so it is not a ship candidate.
Corsfix is a possible contracted vendor but its live development probe discarded
`Range`, so it does not meet the DJ contract today.

## Why ordinary cross-origin playback is not enough

The DJ engine uses an `HTMLAudioElement` with `crossOrigin = "anonymous"` and a
`MediaElementAudioSourceNode`. The Web Audio specification requires that such a
node output silence for a CORS-cross-origin media resource. Therefore a relay
that merely makes an `<audio>` element audible is not sufficient; the final
audio response must pass CORS for the app origin. See [Web Audio API section
1.22.4](https://www.w3.org/TR/webaudio-1.1/#MediaElementAudioSourceOptions-security).

For this app, a usable relay must provide all of the following:

1. anonymous or deliberately frontend-safe access;
2. `Access-Control-Allow-Origin: *` or exactly
   `https://radio.avoid.quest`;
3. real MP3 bytes, not a metadata response or download-job page;
4. exact single-range forwarding with `206`, `Content-Range`, and
   `Accept-Ranges: bytes` in release probes; the browser readiness probe requires
   `Content-Length: 1` when present (CORS-safelisted), but accepts a hidden
   `Content-Range`;
5. correct media content type;
6. no size limit below ordinary Bandcamp tracks;
7. an intended public-use model that does not treat application traffic as
   abuse.

## Probe method

The primary test item was obtained from a live Bandcamp search and freshly
resolved immediately before each probe:

- [Jeff Rosenstock — AMBIENT 106-3000](https://jeffrosenstock.bandcamp.com/track/ambient-106-3000)
- duration: `350.293` seconds
- Bandcamp `mp3-128` object size: `5,605,667` bytes

An over-contract test used:

- [Lowercase Noises — 22](https://lowercasenoises.bandcamp.com/track/22)
- duration: `519.26` seconds
- Bandcamp `mp3-128` object size: `8,408,365` bytes

Every browser-relevant request included:

```http
Origin: https://radio.avoid.quest
Range: bytes=0-65535
```

Viable candidates were then tested with a second disjoint range, a complete
GET, and file-signature inspection. The short-lived signed `t4.bcbits.com` URL
is intentionally not copied into this report.

### Direct Bandcamp baseline

The fresh `t4.bcbits.com` object returned:

- `206 Partial Content`;
- exactly 65,536 requested bytes;
- `Content-Type: audio/mpeg`;
- `Accept-Ranges: bytes` and the correct `Content-Range`;
- **no `Access-Control-Allow-Origin`**.

It is an excellent HTTP media origin but unusable in avoid.quest's Web Audio
graph without a CORS relay. Bandcamp's official API does not solve this: it is
for labels and merchandise partners and exposes account, sales, and merch APIs,
not a public catalog-streaming API. See [Bandcamp's official API scope and
access rules](https://bandcamp.com/developer).

### URL lifetime

Each freshly scraped playback URL encoded a `ts` approximately 86,400 seconds
(24 hours) in the future. A publicly documented stream URL from 2024 now
returned upstream `410` directly and through all three technically viable
relays; each relay preserved the failure and added CORS. That stale-URL probe
cannot distinguish token expiry from later object withdrawal, and a single-day
research run cannot observe the new token crossing its deadline. It does prove
that a byte relay does not refresh an unavailable Bandcamp object. The safe
contract is therefore to treat the signed URL as short-lived and re-resolve it.
The old URL's provenance is [this 2024 capture
walkthrough](https://victorhckinthefreeworld.com/2024/09/18/descargar-audio-de-bandcamp/);
the expiring URL itself is intentionally not repeated here.

Consequences:

- persist the canonical Bandcamp track/album URL, never the relayed signed URL
  as durable identity;
- resolve Bandcamp again when loading a saved deck item or after a `403`/`410`;
- validate the newly resolved hostname as Bandcamp CDN before applying a
  generic proxy prefix.

## Ranked candidates

### 1. Netnr `seep.eu.org` — selected primary

Prefix form:

```text
https://seep.eu.org/<absolute-t4.bcbits.com-url>
```

Historical July measurements from the production origin:

| Probe                                 | Result                                               |
| ------------------------------------- | ---------------------------------------------------- |
| first 64 KiB                          | `206`, exact `Content-Range`, `audio/mpeg`, ACAO `*` |
| middle 64 KiB                         | `206`, exact `Content-Range`, `audio/mpeg`, ACAO `*` |
| six concurrent disjoint 64 KiB ranges | 6/6 exact `206` with CORS                            |
| full 5.61 MB object                   | `200`, exactly 5,605,667 bytes, valid MPEG           |
| 8.41 MB object, bounded range         | exact `206` beyond byte 7.3 MB                       |
| 8.41 MB object, full GET              | `200`, exactly 8,408,365 bytes, valid MPEG           |
| known-stale 2024 Bandcamp URL         | upstream `410`, with ACAO retained                   |
| actual Chrome DJ playback             | **not run**; HTTP contract only                      |

This endpoint has the clearest bare-public-URL intent found. The current Netnr
README gives `seep.eu.org/{URL}` as the usage contract, and the operator's
service page labels `seep.eu.org` unrestricted while separately warning that
its older `cors.eu.org` endpoint is limited and high-volume use is banned. The
distinction matters: `seep.eu.org` is the canonical Netnr primary. Both former
fallback hostnames are now dead.

The July behavior matched the inspected Node source. That proxy piped the
incoming request, including `Range`, to the target; preserved upstream status
and headers; added ACAO `*`; exposed response headers; and followed at most five
redirects. See [CORS response handling](https://github.com/netnr/proxy/blob/72163906423daa0712cb5036a455879c061618b6/app.js#L30-L47),
[request streaming](https://github.com/netnr/proxy/blob/72163906423daa0712cb5036a455879c061618b6/app.js#L57-L116),
and [redirect handling](https://github.com/netnr/proxy/blob/72163906423daa0712cb5036a455879c061618b6/app.js#L118-L197).

The October live probes report `x-release: Netnr.Proxy go1.27.0`. This is a Go
rewrite, not the open-source Node cors-anywhere fork linked above. It forwards
client headers and Bandcamp's `Link: ...; rel="canonical"`, follows upstream
redirects internally, and returns the final body as a plain `200`. There is no
option to disable that redirect-following and no `Location`, `x-final-url`,
`x-request-url`, or `X-CORS-*` final-target signal in the resulting response.
The canonical Link header alone does not verify page identity. Album/track
parsing instead validates `og:url` first, using `data-tralbum.url` only when
`og:url` is missing. The identity must be a Bandcamp URL on the validated final
hostname for direct fetches, or the requested hostname for relayed pages whose
final URL is unavailable; slug paths may differ after a rename. Missing, unsafe,
or wrong-host identity raises a parse error and tries the next source, then
fails closed if no matching page is available. Artist and collection pages
only yield validated release links, whose fetched pages undergo this check.

The round-4 local workerd/Vite probe forced direct metadata fetches to fail.
`AMBIENT 106-3000` resolved through seep and passed the browser's one-byte relay
probe. Loading the canonical link through the Bandcamp card onto DJ deck A
then played to `0:23 / 5:50`, with nonzero left/right Web Audio meter samples,
`isPlaying: true`, and no playback error. Seep returned
`x-release: Netnr.Proxy go1.27.0 2026-09-20`, the canonical Link, and none of the
final-URL headers above. This checks local workerd resolution and Chromium
playback, not deployed Worker egress or physical listening. Temporary forced
failure/logging code was removed after the probe.

No application-level request-rate, timeout, or response-size limit was found in
the tested revision, and the 8.41 MB object passed. Those are absences in the
July source, not an SLA or evidence about the current Go deployment: Cloudflare
and the origin host can impose undocumented limits. The inspected Node
configuration disabled upstream TLS certificate verification; current Go TLS
and redirect limits remain unverified. avoid.quest must validate the fresh
Bandcamp CDN hostname before prefixing it and must never expose a general relay
input. See [the deployed configuration in source](https://github.com/netnr/proxy/blob/72163906423daa0712cb5036a455879c061618b6/app.js#L461-L480).

**Disposition:** first pool choice, subject to routine release probes. Do not
interpret “unrestricted” as an availability or bandwidth guarantee.

### 2. CORS.SH anonymous — dead (NXDOMAIN), removed; July Chrome DJ passed

The October DNS probe returns NXDOMAIN for `proxy.cors.sh`. The measurements
and provider documentation below describe the July candidate, not a live relay.

Prefix form:

```text
https://proxy.cors.sh/<absolute-t4.bcbits.com-url>
```

Observed from the production origin:

| Probe                                 | Result                                               |
| ------------------------------------- | ---------------------------------------------------- |
| first 64 KiB                          | `206`, exact `Content-Range`, `audio/mpeg`, ACAO `*` |
| middle 64 KiB                         | `206`, exact `Content-Range`, `audio/mpeg`, ACAO `*` |
| ten concurrent disjoint 64 KiB ranges | 10/10 `206`; 0.75-0.99 s in that run                 |
| full 5.61 MB object                   | `200`, 5,605,667 bytes, valid MPEG, 0.44 s           |
| 8.41 MB object, bounded ranges        | exact `206` for both ranges                          |
| 8.41 MB object, `Range: bytes=0-`     | `206`, all 8,408,365 bytes                           |
| 8.41 MB object, full GET              | `200`, all 8,408,365 bytes                           |
| known-stale 2024 Bandcamp URL         | upstream `410`, with ACAO retained                   |
| actual Chrome DJ playback             | **passed**; visible progress reached `0:05 / 5:50`   |

The Chrome run loaded the canonical Jeff Rosenstock item through the Bandcamp
platform card onto deck A, wrapped its freshly resolved CDN URL with CORS.SH,
and played it. Chrome DevTools Protocol observed `206`, `audio/mpeg`,
`Content-Range: bytes 0-5605666/5605667`, `Accept-Ranges: bytes`, ACAO `*`, and
no runtime errors. This is the only candidate in this report with a completed
end-to-end DJ/Web Audio run; the Netnr candidates have stronger-than-smoke HTTP
coverage but were not run through Chrome after their late discovery.

Why it works: the proxy forwards request headers (including `Range`), streams
the upstream response, preserves upstream status/headers, and applies CORS.
The [official API reference](https://cors.sh/docs/api-reference) describes the
status/header pass-through and streaming behavior. The tested source revision
also shows that `Range` is not among the stripped request headers and the body
is streamed rather than buffered.

Risks that prevent an unconditional recommendation:

- public docs say `x-cors-api-key` is required, even though the committed spec
  and live endpoint retain keyless access;
- keyless access is explicitly a legacy anonymous tier, not an SLA;
- the service spec says 6 MB per request, while live code currently checks the
  request body size rather than the upstream response and allowed the 8.41 MB
  probe;
- the project's own launch checklist still calls out AUP confirmation,
  observability, and legal/trust work;
- any public generic proxy is a single third-party bandwidth dependency.

**Disposition:** removed from the shared metadata/browser relay list because
the hostname is dead. In July it was the independent second choice with a
Chrome playback pass. CORS.SH
documents frontend-visible, origin-pinned keys as its intended production
model; the free account quota is 10,000 requests and 5 GB per month, while Pro
is 500,000 requests and 500 GB. See [authentication](https://cors.sh/docs/authentication)
and [limits](https://cors.sh/docs/limits).

### 3. Netnr `cors.zme.ink` — dead (NXDOMAIN), removed

The October DNS probe returns NXDOMAIN. The results below are historical July
measurements, and this hostname is no longer in the relay list.

Prefix form:

```text
https://cors.zme.ink/<absolute-t4.bcbits.com-url>
```

It passed the same first/middle ranges, six concurrent disjoint ranges, exact
5.61 MB and 8.41 MB complete files, media type, CORS, and stale-upstream `410`
checks as `seep.eu.org`. It also returned the identical
`x-release: Netnr/10.0.8` marker. It is not listed as the usage URL in the
current Netnr proxy README, so its intended lifecycle is less explicit.

**Verdict:** dead, removed. Its July pass did not establish independent
redundancy. It did not receive a Chrome DJ run.

### 4. CORS.SH origin-pinned live key — technically strongest, not anonymous

The byte path is identical to candidate 2. A `live_` key is intentionally safe
to include in frontend code and is authorized by the browser's `Origin`; an
allowed-target restriction can constrain it to Bandcamp CDN. This is a better
operational fit than depending on the keyless legacy tier, but it requires an
account and quota ownership. It therefore does not meet the strict "few bare
public URLs with no coordination" requirement.

**Verdict:** ship only after the project owner explicitly chooses this vendor
dependency and owns the account/quota.

### 5. Corsfix registered-domain service — no ship for DJ mode

An anonymous production-origin request returned `403 domain_not_registered` as
documented. From an allowed localhost origin, both bounded `Range` probes were
accepted but returned `200` and the complete 5,605,667-byte file instead of
`206`; a full GET behaved identically. CORS and content type were correct, but
range semantics were not.

Corsfix is clearly intended for production use after domain registration and
offers an open-source sponsorship path. Its documentation claims streamed
responses, no response-size limit, and a 20-second timeout. Those are stronger
operational promises than anonymous proxies, but the live failure to preserve
Range makes it unsuitable for the DJ deck today. See [Corsfix API
documentation](https://corsfix.com/docs/cors-proxy/api), [free/open-source
options](https://corsfix.com/docs/free-tier), and [quotas](https://corsfix.com/docs/cors-proxy/quotas).

## Tent: all official clearnet instances

Tent is the only maintained Bandcamp-specific alternative frontend found. Its
current registry contains eleven clearnet instances and explicitly exposes an
`audio.php` rewrite for Bandcamp CDN URLs. See [Tent's current instance
registry](https://forgejo.sny.sh/sun/Tent/src/commit/3cbaa4fc21741b0ec889ba3dc591b47057f82e41/instances.json)
and [the official frontend documentation](https://tent.sny.sh/).

The implementation explains the live results. `audio.php` reconstructs a
`t4.bcbits.com` URL, while `proxy_file` follows the upstream and writes its body.
It does not forward the incoming `Range` header, propagate the upstream status,
or add CORS. It reads the content type before executing cURL, which normally
falls back to `application/octet-stream`. See [audio.php](https://forgejo.sny.sh/sun/Tent/src/commit/3cbaa4fc21741b0ec889ba3dc591b47057f82e41/pages/audio.php)
and [the proxy helper](https://forgejo.sny.sh/sun/Tent/src/commit/3cbaa4fc21741b0ec889ba3dc591b47057f82e41/utilities/file.php).

Live results using the same fresh track:

| Instance                | Anonymous audio      | Range result             | CORS | Other finding                           | Verdict |
| ----------------------- | -------------------- | ------------------------ | ---- | --------------------------------------- | ------- |
| `bandcamp.lurkmore.com` | full 5,605,667 bytes | ignored; `200` full body | none | release page worked                     | no ship |
| `tent.bloat.cat`        | challenge HTML       | n/a                      | none | Anubis "Just a moment"                  | no ship |
| `tent.canine.tools`     | full 5,605,667 bytes | ignored; `200` full body | none | release page worked                     | no ship |
| `tent.deep-swarm.xyz`   | full 5,605,667 bytes | ignored; `200` full body | none | release lookup did not resolve the item | no ship |
| `tent.lab8.cz`          | unavailable          | n/a                      | n/a  | self-signed TLS certificate             | no ship |
| `tent.nbh.ax`           | 58-byte refusal      | n/a                      | none | disabled due to AI scrapers             | no ship |
| `tent.private.coffee`   | full 5,605,667 bytes | ignored; `200` full body | none | release lookup did not resolve the item | no ship |
| `tent.sny.sh`           | full 5,605,667 bytes | ignored; `200` full body | none | official instance; release page worked  | no ship |
| `tn.dc09.ru`            | unavailable          | n/a                      | none | redirected to `tn.dc09.xyz`, then `502` | no ship |
| `tn.maid.zone`          | full 5,605,667 bytes | ignored; `200` full body | none | release lookup did not resolve the item | no ship |
| `tn.vern.cc`            | full 5,605,667 bytes | ignored; `200` full body | none | release page worked                     | no ship |

Tent endpoints are intended for human use through the Tent frontend, so they
are more legitimate than an arbitrary leaked proxy. Nevertheless, not one is a
Web Audio relay for this app. Rotating among them cannot repair a protocol-level
absence of CORS and Range support.

## Other generic CORS proxies

All candidates below received the production `Origin` and bounded Range probe.
Full downloads were attempted only after a candidate passed the initial byte
and CORS gate.

| Service                                                 | Live result                                                                    | Public-use intent / limits                                                                                              | Classification                                | Verdict |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------- |
| `corsproxy.io`                                          | `403`; "Server-side requests are not allowed on your plan"                     | anonymous use is development-only; production media is paid                                                             | byte relay, gated                             | no ship |
| AllOrigins raw                                          | `200`, ignored Range, connection died after 262,690 bytes                      | public convenience API; no media SLA                                                                                    | broken byte relay                             | no ship |
| CodeTabs                                                | `522` after about 20 s                                                         | documented 5 requests/s but unavailable in this probe                                                                   | unavailable                                   | no ship |
| `api.cors.lol`                                          | immediate `429`                                                                | site says free noncommercial but rate-limited                                                                           | byte relay, unavailable                       | no ship |
| CORS Anywhere demo                                      | `403`; demo opt-in page                                                        | maintainer explicitly says host your own for traffic                                                                    | demo only                                     | no ship |
| Cloudflare CORS Anywhere demo (`test.cors.workers.dev`) | exact `206` ranges and complete valid 5.61 MB MP3; correct media type and ACAO | operator says any demo use beyond testing can trigger a ban                                                             | technically valid byte relay; prohibited demo | no ship |
| Netnr `cors.eu.org`                                     | immediate `429`                                                                | operator labels it limited and says high-volume use is banned; `seep.eu.org` is the documented unrestricted replacement | unavailable legacy relay                      | no ship |
| `cors.iamnd.eu.org`                                     | Cloudflare `403`                                                               | no usable public contract found                                                                                         | unavailable                                   | no ship |
| x2u (`go.x2u.in`)                                       | current service requires email/API key                                         | 750 KB response cap, 100 requests/hour/email domain, 20-second timeout; development/testing only                        | gated, undersized                             | no ship |
| `crossorigin.me`                                        | DNS failure                                                                    | its own docs warned against production and capped files at 2 MB                                                         | dead                                          | no ship |
| `thingproxy.freeboard.io`                               | DNS failure                                                                    | old public demo                                                                                                         | dead                                          | no ship |
| `cors.isomorphic-git.org`                               | rejected/non-git Cloudflare page                                               | intentionally restricted to Git traffic and small projects                                                              | wrong service                                 | no ship |
| Whatever Origin                                         | request-processing error                                                       | JSON/JSONP wrapper, 20 rpm/site, no uptime guarantee                                                                    | not a streaming relay                         | no ship |

Important primary-source details:

- CORS.lol's current source hard-codes only 20 requests per five minutes per
  client and creates a new upstream GET without copying the incoming `Range`
  header. See [main.go at the tested revision](https://github.com/BradPerbs/cors.lol/blob/4f8fd6f41ffd9e7a55f68ecd6d032474637ebe94/main.go#L15-L28)
  and [its request construction](https://github.com/BradPerbs/cors.lol/blob/4f8fd6f41ffd9e7a55f68ecd6d032474637ebe94/main.go#L85-L111).
- CORS Anywhere calls its hosted server a limited public demo and tells
  high-traffic users to self-host with an origin whitelist. See [the official
  repository's demo-server policy](https://github.com/Rob--W/cors-anywhere#demo-server).
- Zibri's Cloudflare CORS Anywhere demo passed the media protocol tests, but its
  README says demo abuse other than testing results in a ban and tells users to
  deploy their own copy. See [the operator's explicit demo
  policy](https://github.com/Zibri/cloudflare-cors-anywhere#readme).
- Netnr itself distinguishes the limited `cors.eu.org` service from the
  unrestricted `seep.eu.org` service on its [operator service
  page](https://netnr.com/134). They must not be treated as interchangeable.
- isomorphic-git's proxy explicitly blocks requests that do not look like Git
  operations. See [its package documentation](https://github.com/isomorphic-git/cors-proxy).
- corsproxy.io says production domains and binary/media support require a paid
  production plan; see [pricing and file-type limits](https://corsproxy.io/pricing/).
- Whatever Origin explicitly gives the public endpoint no uptime guarantee and
  recommends self-hosting or a production provider; see [its FAQ](https://www.whateverorigin.org/).

## Metadata resolvers and extractors are not byte relays

Several projects successfully return fresh Bandcamp stream URLs. They do not
carry audio bytes and therefore do not solve the browser CORS problem.

| Project/service                               | Live result                                                        | Classification                         | Verdict                                    |
| --------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------ |
| avoid.quest `@avoid.quest/platforms` resolver | fresh canonical metadata and signed `t4` URL                       | metadata resolver                      | keep control plane; still needs byte relay |
| `bandcamp-api.vercel.app`                     | `200`, ACAO `*`, JSON containing the same direct `t4` URL          | public metadata resolver               | redundant; no byte solution                |
| `bc.wemakesites.net`                          | public site key returned album/player JSON with direct `t4` URLs   | API-key metadata resolver              | no byte solution                           |
| yt-dlp 2026.07.04                             | live extraction succeeded and returned Bandcamp's direct formats   | local extractor/downloader             | not a hosted relay                         |
| NewPipeExtractor 0.26.3                       | official Bandcamp extractor reads the page's `file["mp3-128"]` URL | local Java extraction library          | not a hosted relay                         |
| cobalt 11.7.1 hosted API                      | live service list omitted Bandcamp; processing required JWT        | hosted downloader API without Bandcamp | unsupported                                |

The Vercel API's own README describes it as an API based on
`bandcamp-scraper`; its response exposes Bandcamp's URL rather than proxying
the object. See [thde/bandcamp-api](https://github.com/thde/bandcamp-api/tree/0d64f0c18d7e92a148d31d576936b7634d0679f5).
The older [bc.wemakesites.net player method](https://bc.wemakesites.net/methods/player)
similarly advertises track data for a custom player, not a byte tunnel.

yt-dlp has first-class Bandcamp extractors and was healthy in the live probe.
Its source reads `trackinfo.file` and returns those URLs as formats; it does not
become a public relay unless someone deliberately hosts another service around
it. See [the supported-site list](https://github.com/yt-dlp/yt-dlp/blob/59d9ae606a24a80523da35de9fb75b71eb35b501/supportedsites.md#L121-L124)
and [the Bandcamp extractor](https://github.com/yt-dlp/yt-dlp/blob/59d9ae606a24a80523da35de9fb75b71eb35b501/yt_dlp/extractor/bandcamp.py#L156-L188).

NewPipe is relevant as a **data-source implementation**, not a relay. The
current app and extractor officially support Bandcamp, but
`BandcampStreamExtractor.getAudioStreams()` simply reads
`trackinfo[0].file["mp3-128"]` from the Bandcamp page and returns that direct
URL as an MP3 stream. There is no official public NewPipe extraction service or
instance registry to prefix in a web client. Embedding the Java library would
replace metadata extraction while leaving the identical browser CORS problem.
See [NewPipe's supported-service list](https://github.com/TeamNewPipe/NewPipe#supported-services),
[the 0.26.3 Bandcamp service API](https://teamnewpipe.github.io/NewPipeExtractor/javadoc/org/schabi/newpipe/extractor/services/bandcamp/BandcampService.html),
and [the exact stream extraction at the inspected source revision](https://github.com/TeamNewPipe/NewPipeExtractor/blob/7edf1c5f68e177b3ec98d2a0c7b50503a67ba385/extractor/src/main/java/org/schabi/newpipe/extractor/services/bandcamp/extractors/BandcampStreamExtractor.java#L155-L164).

Cobalt is not a substitute. Its current supported-service table does not list
Bandcamp, and its official API documentation says hosted instances are not
intended for embedding in other projects without permission and recommends
self-hosting. See [Cobalt's supported services](https://github.com/imputnet/cobalt/blob/main/api/README.md#supported-services)
and [hosted API policy](https://github.com/imputnet/cobalt/blob/main/docs/api.md).

## Integration boundary

Keep provider choice static and the playback path small:

1. keep the existing canonical Bandcamp metadata/search resolver. Page metadata
   tries a direct HTTPS fetch first, then the app-owned relay list in order when
   the request fails or lacks usable page data. Direct Worker fetches appear to
   be challenged by Bandcamp; this is unconfirmed, so the relay is a fallback;
   artist and collection item loads use four workers and one shared deadline;
   successful child loads remain available when that deadline expires. Only
   Bandcamp album/track links are followed; page targets require a Bandcamp
   hostname, no credentials or custom ports, and are rebuilt from
   `origin + pathname + search`, and are percent-encoded as a whole for the
   relay's single decode. Direct redirects remain manually validated, and relay
   requests allow zero HTTP redirects. Since seep follows its upstream redirects
   without exposing the final URL, album/track parsing requires a safe Bandcamp
   identity with the requested hostname: `og:url`, or `data-tralbum.url` only
   when `og:url` is absent, allowing slug renames. Missing or mismatched
   identity falls through as a parse error, then fails closed.
   Artist/collection pages need no identity check; their release URLs are
   validated before fetching and their release pages are checked when parsed;
2. validate every resolved stream URL and artwork URL inside
   `@avoid.quest/platforms` with the Bandcamp CDN URL policy (`bcbits.com`, no
   credentials); the browser retains its stream check before adding the relay;
3. probe the sole live relay, `seep.eu.org`, under one deadline with an exact
   one-byte range request; the two NXDOMAIN hosts are removed;
4. select the highest-priority response that returns `206`, an audio MIME type,
   `Content-Length: 1` when present, and a real body byte. `Content-Range`
   is not required because these relays can hide it from browser CORS;
5. apply that prefix exactly once; do not add a server-side byte fallback or
   arbitrary custom-proxy input;
6. persist the canonical Bandcamp item, not its signed CDN URL, and re-resolve
   when a stale object returns `403`/`410`;
7. fail plainly only when every curated relay is unavailable;
8. maintain one release probe per independent family that checks ACAO, media
   type, an exact bounded range, and a track above 6 MB.

This removes avoid.quest audio-byte infrastructure while keeping each external
dependency auditable. Do not add Tent as a fallback: it increases code and
still cannot feed the Web Audio graph. Also do not count both Netnr hostnames as
two independent reliability providers.

Direct page fetches now send a Chrome 155 User-Agent (checked against the
[official stable release catalog](https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Windows&num=1))
plus normal `Accept` and `Accept-Language` headers. This is a small egress
diagnostic step, not proof that deployed Worker fetches work. The follow-up remains
`wrangler dev --remote` / `wrangler tail` to inspect direct production egress.

Production Chromium/macOS reported missing JSON-LD/tralbum data from the
deployed Worker on October 7, while Observability only showed the server-function
request. A single `console.warn` with `stage: "bandcamp-direct"` now records
direct network/HTTP failures or missing page data only when falling back.
It includes the requested hostname, status, the four allowed response headers
(`server`, `content-type`, `cf-mitigated` when present, `content-length`), body
length, data/challenge booleans, and an 80-character title. It excludes URL
queries, response bodies, cookies, IPs, and error messages. The direct attempt
owns the warning, so it emits at most once per item load; relay failures,
security rejections, purchase-only pages, and loads without a relay do not emit it.

## Final ship/no-ship statement

- **Netnr `seep.eu.org`:** shipped primary; clearest bare-public intent and an
  historical exact HTTP media pass; October local workerd resolution and
  Chromium DJ/Web Audio playback passed with direct metadata fetch forced to fail.
- **CORS.SH anonymous:** dead (NXDOMAIN), removed; historical Chrome DJ pass.
- **Netnr `cors.zme.ink`:** dead (NXDOMAIN), removed; same July failure domain.
- **CORS.SH origin-pinned key:** preferred production form if the owner accepts
  an account/quota and obtains explicit provider assurance.
- **Tent fleet:** no ship.
- **Corsfix:** no ship until it preserves Range, even after domain registration.
- **Cloudflare CORS Anywhere demo:** technical pass, no ship because the
  operator explicitly limits it to testing.
- **All other anonymous generic proxies tested:** no ship.
- **yt-dlp, NewPipeExtractor, Cobalt, Vercel API, wemakesites API:** not byte
  relays; no ship as an audio solution.

There are indeed many public endpoints in this space, but the majority are
metadata resolvers, download-job APIs, development demos, or proxies that do
not preserve the media/CORS contract required by a DJ Web Audio graph. The
shipped shortlist is now one live relay with no independent fallback.
