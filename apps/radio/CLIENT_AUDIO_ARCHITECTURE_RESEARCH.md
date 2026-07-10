# Client-first audio architecture research

Verified against repository source and primary/official sources on 2026-07-10.

## Executive conclusion

The chosen target is **client-first, with no official provider APIs or embeds and no loss of DJ capability**:

1. Keep the mixer, CUE bus, effects, meters, speed, and crossfader in the browser.
2. Resolve a user/provider reference into a direct HTTPS+CORS media URL whenever one exists.
3. Let Radio Browser run browser-direct and retain only small replaceable resolution services where a provider blocks browser lookup.
4. Move unavoidable byte relaying to user-configured self-hosted services rather than avoid.quest.
5. Keep the current avoid.quest relays only during migration; never silently downgrade a deck to transport-only playback.

A fleet of reliable proxies can improve availability, but it does not change the browser invariant: a `MediaElementAudioSourceNode` must output silence for CORS-cross-origin media because Web Audio can expose samples to script ([Web Audio specification](https://www.w3.org/TR/webaudio-1.0/#MediaElementAudioSourceOptions-security)). A service worker cannot turn `no-cors` into readable bytes: an opaque response exposes status `0`, no headers, and no body to script ([Fetch Standard](https://fetch.spec.whatwg.org/#concept-filtered-response-opaque)).

The provider verdicts are therefore different:

| Source | Recommended full-DJ route | Does a better proxy materially help? | Verdict |
| --- | --- | --- | --- |
| User file/device | Browser-native blob or `MediaStream` | No proxy needed | First-class full DJ |
| HTTPS radio/progressive audio with CORS | Direct `<audio crossorigin>` | No | First-class full DJ |
| CORS-clean HLS | Direct HLS/native or hls.js | No | First-class full DJ |
| SoundCloud | Maintained yt-dlp resolver, then current CORS-readable CDN media direct | Only for resolution availability; Cobalt is a byte-relaying fallback | Best opportunity to remove avoid.quest audio completely |
| Radio Garden | Keep its undocumented lookup behind a tiny replaceable resolver; play station origin direct | A resolver helps discovery, but not station-origin failure | Optional discovery adapter, not a transport dependency |
| Arbitrary non-CORS or HTTP radio | Narrow relay, preferably station-operated or user-supplied | Yes | Relay remains necessary for full DJ |
| Bandcamp | yt-dlp or bandcamp-fetch resolver plus a user-configured byte relay | Yes; current bcbits media has Range but no CORS | Full DJ cannot be resolver-only |
| YouTube | User-configured Invidious+Companion or Piped backend+proxy | Independent coupled clusters improve instance/IP outages | Full DJ remains relay-backed and provider-fragile |

This is an engineering and product assessment, not legal advice. “The browser fetches it” and “we do not curate the content” do not by themselves override provider terms or rightsholder restrictions. In particular, YouTube prohibits separating or modifying the audio/video components and background players ([YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies#i.-additional-prohibitions)). SoundCloud’s current API terms require attribution, generally prohibit modifying user content without the uploader's express permission, prohibit playback experiences that aggregate SoundCloud with other services, and prohibit webcasting radio apps ([SoundCloud API Terms](https://developers.soundcloud.com/docs/api/terms-of-use)).

## What the repository already does

The advanced audio implementation and the new playback decision seam are client-side:

- `apps/radio/src/lib/audio/playback/media-element-playback-source.ts` connects an anonymous-CORS `HTMLAudioElement` to the existing Web Audio graph. The mixer, CUE bus, effects, meters, speed, and crossfader remain browser-owned.
- `apps/radio/src/lib/audio/playback/playback-source.ts` now accepts an ordered `PlaybackInput` instead of one assumed-usable URL. `apps/radio/src/lib/audio/playback/playback-source-preparer.ts` prepares plain media direct first, then each enabled compatible user relay, then the temporary avoid.quest relay. HLS is offered only to relays that declare full-HLS support.
- `packages/platforms/src/radiobrowser/index.ts` discovers official Radio Browser mirrors and searches them directly from the browser. `apps/radio/src/lib/hooks/use-unified-radio-search.ts` combines those results with local stations and the retained Radio Garden search.
- `apps/radio/src/lib/relay/relay-configuration.ts` persists user-supplied stream relays after a capability handshake. Requests omit credentials and referrers; users can verify, enable, disable, or remove services in `apps/radio/src/components/settings/relay-settings.tsx`.
- `packages/platforms/src/youtube/` contains strict browser adapters for Invidious and Piped plus ordered failover. `apps/radio/src/lib/youtube/` persists the user’s provider order and builds the browser client used by search, URL loading, playlist progression, and stream refresh. No public instance or provider secret is built in.
- The old server-side YouTube helpers and environment binding, the server-side `stream-access` decision layer, and the throwaway audio-ingress prototype have been removed. `apps/radio/src/utils/platform.functions.ts` now fails closed if YouTube reaches its server path.

Three migration gaps remain:

1. **Some avoid.quest compatibility routes still carry audio.** The generic `/api/stream-proxy` is the final temporary fallback, while SoundCloud and Bandcamp still use provider-specific proxy routes.
2. **Radio Garden still needs a small server control plane.** Its undocumented search and redirect resolution remain server-side even though the resolved station audio enters the same direct-first playback path.
3. **Non-CORS HLS needs an HLS-aware relay.** Relaying only the manifest URL does not make child playlists, segments, maps, or keys readable. hls.js requires every HLS resource to permit CORS ([hls.js official README](https://github.com/video-dev/hls.js#cors)); the configured relay must declare and implement full-HLS support.

### Built-in station header survey

On 2026-07-10, all ten built-in stream URLs from `src/lib/const.ts` were sampled with `curl -sSIL --range 0-0` and `Origin: https://avoid.quest`, following redirects:

- Sygma, Lyl, Cashmere, Resonance Extra, Internet Public Radio, RadioJar/Radio Alhara, and both final NTS media endpoints exposed `Access-Control-Allow-Origin`.
- The initial NTS redirect responses did not expose CORS, but their final audio endpoints did.
- Radio BlackOut returned `404`; Gatto Misterioso returned `503` during the sample.

This is strong evidence that direct-first will remove the backend data path for most current built-ins. It is not a browser playback proof: several Icecast endpoints returned non-`200` responses to `HEAD`/range probes while still exposing CORS, so the production decision should be based on an actual anonymous-CORS media load plus a bounded cache, not `HEAD === 200`.

## The non-negotiable browser constraints

### CORS is sample-read permission

Cross-origin media may be playable as ordinary media without being usable by the DSP graph. Web Audio deliberately silences a media-element source whose fetch is CORS-cross-origin ([Web Audio specification](https://www.w3.org/TR/webaudio-1.0/#MediaElementAudioSourceOptions-security)). Setting `crossOrigin = "anonymous"` before `src` is necessary but not sufficient; the final media response must grant the app origin or `*` through CORS.

The result is binary for the existing DJ engine: if the browser cannot read the samples, EQ, effects, meters, CUE, and crossfading cannot honestly be described as working. A “transport-only” embed is a separate capability, not a weaker implementation of the same deck.

### Service workers, WASM, WebCodecs, and client-side demuxing do not bypass CORS

All of those implementations still need script-readable response bytes. A `no-cors` fetch returns an opaque filtered response with no exposed body ([Fetch Standard](https://fetch.spec.whatwg.org/#concept-filtered-response-opaque)). A service worker can cache/replay such a response for uses that accept opaque media, but cannot reveal its bytes to Web Audio, a decoder, or WASM.

### HTTPS matters independently of CORS

On an HTTPS app, mixed audio is subject to mixed-content upgrading; if upgrading an HTTP audio URL to HTTPS fails, the request is blocked ([W3C Mixed Content specification](https://www.w3.org/TR/mixed-content/#upgrade-algorithm)). A relay can bridge a legacy HTTP station to HTTPS, but a resolver-only backend cannot.

### HLS is a graph of requests, not one URL

hls.js requires all HLS resources to be served with CORS headers permitting `GET`, and uses MSE where supported; native HLS is used on supported Safari-family paths ([hls.js official README](https://github.com/video-dev/hls.js#compatibility), [hls.js CORS requirement](https://github.com/video-dev/hls.js#cors)). Direct HLS therefore works only when manifests, variants, segments, maps, and keys are all accessible. A relay fallback must parse and rewrite manifests recursively; proxying the top-level `.m3u8` alone is not sufficient.

## Direction analysis

### Direction A — direct-only PWA

**Shape:** The browser resolves or receives final media URLs, probes them with CORS, and loads only direct-readable sources.

**Benefits:** No audio egress, no open-proxy surface, minimum latency, independent station/provider scaling, and the simplest privacy story.

**Limit:** Coverage is deliberately smaller. Non-CORS streams, legacy HTTP stations, and closed embeds cannot enter the full-DJ graph.

**Best use:** Make this the default route and curate the built-in station list toward HTTPS+CORS. Let users see “Full DJ” or “external relay needed” before loading.

### Direction B — resolver-only control plane

**Shape:** A small backend holds credentials, resolves provider references, and returns a short-lived final URL; the browser fetches audio directly.

**Benefits:** Secrets and quotas stay server-side while audio avoids the backend. Resolution requests are small and cacheable by canonical provider ID.

**Limit:** It works only when the returned URL is CORS-readable from the browser and is not bound to the resolver’s source IP. It also cannot upgrade an HTTP-only station.

**Best use:** A thin yt-dlp SoundCloud resolver returning a fresh direct CDN candidate, Radio Garden-to-station redirects, and metadata/search for direct stations.

### Direction C — provider-specific relays

**Shape:** A relay accepts only a provider’s known CDN hosts and headers, follows only validated redirects, and streams bytes without buffering.

**Benefits:** Smaller SSRF and abuse surface, provider-specific recovery, and better observability than a generic URL relay. It is technically appropriate when a provider URL is bound to the resolver’s IP: resolution and byte retrieval stay on the same egress path.

**Limit:** The app still transmits all audio bytes. A relay cannot cure provider-wide extractor breakage, policy restrictions, or missing rights. It becomes a bandwidth and abuse-sensitive production subsystem.

**Best use:** A bounded compatibility tail where the product intentionally supports the provider and its terms allow the use.

### Direction D — generic public-radio relay

**Shape:** A user supplies any public HTTP(S) stream and the backend converts it to a same-origin, CORS-readable response.

**Benefits:** Maximum station compatibility, including HTTP and non-CORS Icecast/Shoutcast streams.

**Limit:** This is the highest-risk direction because arbitrary user URLs create an SSRF/open-proxy shape. OWASP notes that arbitrary external destinations cannot use a simple domain allowlist; defenses must validate public IPv4/IPv6 results, protocols, and redirect targets and account for DNS pinning/rebinding ([OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html#case-2---application-can-send-requests-to-any-external-ip-address-or-domain-name)).

**Best use:** Keep it opt-in and tightly budgeted. Do not expose a reusable `?url=` relay ticket indefinitely; issue a short-lived signed capability from a same-origin preparation request.

### Direction E — bring-your-own relay

**Shape:** Advanced users configure a compatible relay endpoint they operate. The app first tries direct; that adapter is a fallback.

**Benefits:** Moves bandwidth and provider choice away from avoid.quest, supports private deployments, and creates a real `RelayAdapter` seam.

**Limit:** Configuration and trust become user-visible. A malicious relay sees requested URLs and all audio. The app must never send app cookies, provider secrets, or unrelated authorization headers to it.

**Best use:** Optional power-user mode, with a documented relay protocol and a prominent trust warning.

### Direction F — browser extension or local/native companion

**Shape:** An explicitly installed extension/native process fetches media with user-granted host permissions and exposes a loopback/extension stream to the app.

**Benefits:** Keeps bytes on the user’s device and can cover non-CORS/HTTP sources without avoid.quest relaying them.

**Limit:** It is no longer a zero-install PWA. It expands permissions, update, signing, and security responsibilities. It also does not make a provider-prohibited use acceptable.

**Decision:** Out of scope. The long-term product remains a browser/PWA.

### Direction G — WebRTC/P2P proxy mesh

**Shape:** Peers or edge nodes relay source bytes over WebRTC/WebTransport.

**Verdict:** Reject for now. Some participant still needs permission and network access to fetch the upstream bytes, so this is a more complex relay, not a CORS solution. It adds discovery, trust, abuse, NAT, availability, and privacy problems while providing little leverage for two-deck audio.

## Maintained open/self-hosted option audit

Maintenance activity is evidence that an option is alive, not a service-level guarantee. The snapshot below was checked on 2026-07-10. “User-hosted” means avoid.quest is no longer in the byte path, but the user's machine/server still is; it does not make a byte relay disappear.

| Option | Maintenance evidence | Deployment and actual role | Web Audio/DJ consequences | Failure domain | License/policy |
| --- | --- | --- | --- | --- | --- |
| Radio Browser | API release `0.7.44` was published about three months before this review ([official releases](https://gitlab.com/radiobrowser/radiobrowser-api-rust/-/releases)) | Public mirror network, or self-hosted native/Deb/Docker directory; **resolver only** | Its JSON API and `url_resolved` remove playlist/redirect resolution work, but the browser still fetches the station. Station CORS, HTTPS, codec, HLS children, and availability are unchanged. Range and IP affinity are not directory concerns. | Mirror request plus independent station origin; self-hosting removes the mirror request but not station failure | Radio Browser server is [AGPL-3.0](https://gitlab.com/radiobrowser/radiobrowser-api-rust/-/blob/master/LICENSE); station rights remain independent |
| Radio Garden | Live hosted product, but no public versioned developer API or self-hostable server was found | Closed hosted directory; undocumented **resolver/redirect** in this repository | A resolved station can play direct only if its final origin is HTTPS+CORS-readable. Otherwise the normal relay rule applies. | Radio Garden is one upstream failure domain, followed by the station; multiple avoid.quest resolver aliases are not independent | No open integration license found; use the published business contact rather than treating site-internal routes as a contract |
| MediaMTX | Official current config identifies `v1.19.2` ([configuration reference](https://mediamtx.org/docs/references/configuration-file)) | User/operator binary or container; configurable live-media **pull relay/remuxer**, especially strong for fixed HLS inputs | Can pull HLS and emit browser-facing HLS with configurable CORS, so the existing hls.js/Web Audio path can consume it. It carries every byte and is not an arbitrary provider extractor; signed/IP-bound provider input still needs a resolver on the same egress. HLS replicas require sticky sessions because one playback is many HTTP requests ([scalability guide](https://mediamtx.org/docs/features/scalability)). | User/operator MediaMTX plus upstream source; replicas/CDN add their own state and cost | [MIT](https://mediamtx.org/docs/misc/license); upstream provider/content rules are unaffected |
| Corsfix | Latest repository commit in this review was 2026-05-23; the project publishes self-hosting instructions ([repository](https://github.com/corsfix/corsfix), [self-hosting](https://corsfix.com/docs/open-source/self-hosting)) | Docker stack or custom deployment; generic streaming **byte relay** | It forwards request/response headers and streams bodies, so progressive Range may work. The current upstream request has a hard 60-second timeout ([source](https://github.com/corsfix/corsfix/blob/main/proxy/app.ts#L125)), unsuitable for indefinite radio without a fork. It does not recursively rewrite HLS; an hls.js loader would have to proxy every playlist, segment, map, and key. IP-bound URLs still require the resolver and relay to share egress. | Relay deployment plus arbitrary upstream; its SSRF defenses are useful, but bandwidth and abuse remain operator-owned | [AGPL-3.0](https://github.com/corsfix/corsfix/blob/main/LICENSE); needs a strict app-origin allowlist and scoped destinations |
| CORS Anywhere | No convincing recent maintenance/release evidence was found; its public demo has required opt-in since 2021 | Small Node generic **byte relay** | Not HLS-aware and not a radio service contract. Its own README says production users should self-host, allowlist their origin, and rate-limit to avoid an open proxy ([official repository](https://github.com/Rob--W/cors-anywhere)). | Single relay plus upstream; unsafe if exposed with broad defaults | MIT; unsuitable as a production drop-in for this threat model |
| Invidious + Companion | Invidious release `v2.20260626.0` and July 2026 activity in both projects ([release](https://github.com/iv-org/invidious/releases/tag/v2.20260626.0), [Companion](https://github.com/iv-org/invidious-companion)) | User/operator Docker service; resolver plus optional/direct **media relay** | Raw URLs can still fail CORS or be bound to the resolver IP. `local=true` deliberately sends bytes YouTube → instance/Companion → browser and is the reliable mode. Public-instance sizing is bandwidth-heavy ([installation guide](https://docs.invidious.io/installation/)). | One coupled Invidious+Companion+egress unit plus YouTube; independent clusters help IP/deployment outages, not extraction changes | AGPL-3.0; YouTube developer policy remains incompatible with isolated/modified audio |
| Piped Backend + Proxy | Backend and proxy both had July 2026 repository activity; neither publishes formal releases ([backend](https://github.com/TeamPiped/Piped-Backend), [proxy](https://github.com/TeamPiped/piped-proxy)) | User/operator Java resolver plus Rust **media relay**, one proxy per backend | The official architecture intentionally keeps extraction and high-throughput delivery together. Use the instance's proxied URLs rather than raw Google URLs; verify `Range`/`206`/`Content-Range` before adding an adapter. | Coupled backend+proxy+egress plus YouTube; official self-hosting docs warn that YouTube bans IPs ([self-hosting](https://docs.piped.video/docs/self-hosting/)) | AGPL-3.0; same YouTube policy conflict |
| yt-dlp resolver | Release `2026.07.04` and July 2026 repository activity ([official release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04)) | CLI/library behind a thin user-hosted authenticated JSON resolver; not an HTTP/CORS media service | SoundCloud candidates can currently go browser-direct. Bandcamp still needs a relay for CORS. Returning a `googlevideo` URL does not solve YouTube CORS, expiry, required headers, or IP affinity, so YouTube still needs a coupled relay. | User resolver plus provider; any required relay is a second controlled failure domain | Unlicense; frequent extractor updates and provider-specific token/IP blocks remain operational risks ([official PO-token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)) |
| Cobalt | Repository updated in July 2026, but no releases; its hosted API explicitly is not for other projects without permission ([repository](https://github.com/imputnet/cobalt), [API docs](https://github.com/imputnet/cobalt/blob/main/docs/api.md)) | Self-hosted multi-provider resolver/download service; returns `redirect`, **tunnel**, or local-processing modes | `redirect` is useful only when the final URL already satisfies CORS/IP rules. `tunnel` is the reliable path and therefore a byte relay. Its contract is download-oriented; range seeking, long playback, expiry, MIME, and startup must pass conformance tests before use. | Cobalt instance plus provider; public hosted API is not an available dependency | API is AGPL-3.0; each provider's policy remains independent |

### What this audit changes

- **Radio Browser is the best directory replacement**, because it changes only the control plane and naturally leaves station audio direct.
- **MediaMTX is the best ready-made BYO component for fixed HLS/restreaming**, not a universal URL/provider proxy.
- **Corsfix is the closest maintained generic CORS relay codebase**, but its timeout and missing HLS rewriting mean it needs a radio-specific fork/protocol before it can back full DJ.
- **Invidious Companion and Piped Proxy are the strongest maintained experimental YouTube relays.** They move bytes off avoid.quest when user-hosted; they do not make playback relay-free or policy-compatible.
- **yt-dlp is the strongest shared resolver engine for SoundCloud and Bandcamp**, but it is not a ready-made streaming proxy and cannot make YouTube resolver-only.
- **Do not depend on random public instances.** Require a user-supplied endpoint, run a capability/health handshake, and identify the media path as `direct` or `external-relay`.

## Provider-by-provider analysis

### SoundCloud: maintained unofficial resolver, direct media

The product decision excludes SoundCloud's official API. The strongest maintained common resolver is therefore yt-dlp: release `2026.07.04` includes active SoundCloud extraction and exposes selectable progressive and HLS formats without downloading them ([yt-dlp release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04), [SoundCloud extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/soundcloud.py)). It is a CLI/library, not a ready-made multi-tenant service, so the deployable unit is a thin authenticated, rate-limited JSON resolver kept current with yt-dlp releases.

Live probes on 2026-07-10 found that a current progressive MP3 on `cf-media.sndcdn.com` returned `206`, byte-range support, and `Access-Control-Allow-Origin: *`. The HLS manifest and sampled segment also exposed wildcard CORS, and the segment honored Range. That makes resolver-only SoundCloud technically viable: resolve just before deck load, return the fresh media candidate, and let the browser carry audio directly into the existing Web Audio graph. The sampled signed URL lifetime was roughly two hours, so persist the canonical SoundCloud URL/track identity, not media URLs, and resolve once more after a `401`/`403`.

The implementation should try progressive first because its Range/CORS behavior is simpler to validate for deck seeking, then use CORS-clean HLS as fallback. The current code already knows one SoundCloud HLS host permits CORS but proxies progressive media; its host policy needs to follow observed current CDN behavior rather than protocol alone. Cross-egress URL portability was not proven, so the conformance test must resolve from one network and play from another before declaring the resolver universally direct.

This remains an unofficial integration with extraction, rate, breakage, and provider-policy risk. SoundCloud's published terms are still relevant evidence even though its API will not be used: they restrict content modification, multi-service aggregation, and webcasting ([SoundCloud API Terms](https://developers.soundcloud.com/docs/api/terms-of-use)).

**Proxy verdict:** Use yt-dlp as a small resolver and fetch media browser-direct. Keep a user-configured Cobalt tunnel only as an explicit fallback; Cobalt's own SoundCloud path returns a tunnel and therefore carries the bytes ([Cobalt API](https://github.com/imputnet/cobalt/blob/main/docs/api.md)).

### YouTube/Invidious: proxies help operations, not the fundamental fit

The product decision is to preserve the full DJ graph and skip official APIs/embeds, so the YouTube IFrame is not a candidate: it exposes transport controls rather than PCM/media URLs ([YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)). The policy risk must still be recorded: YouTube prohibits separating, isolating, or modifying audio/video components and hidden/background playback ([YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies#i.-additional-prohibitions)).

The current technical route uses Invidious `/api/v1/videos/:id?local=true`. Invidious documents that current playback requires Invidious Companion; public instances are bandwidth intensive, need substantial traffic capacity, and should be restarted frequently ([Invidious installation](https://docs.invidious.io/installation/)). Invidious also documents several independent failure modes: YouTube rate-limiting an instance, non-official-client detection, datacenter/VPN IP blocks, PO-token/player changes, and `googlevideo` 403s. Some video URLs must be fetched from the same IP that generated them ([Invidious YouTube error guide](https://docs.invidious.io/youtube-errors-explained/)).

Consequences for a hypothetical supported experimental adapter:

- A resolver-only architecture is insufficient for IP-bound URLs. Use `local=true` or a coupled resolver+byte relay on the same egress identity.
- Do not hand a URL resolved by instance A to relay B. On failover, re-resolve the canonical video ID on B and play B’s local URL.
- Treat URLs as leases. Store `videoId`, resolve just before load, and re-resolve on 403/expiry/interruption.
- Run Invidious and Companion as one failure-domain unit. The Invidious project recommends exposing Companion directly behind the reverse proxy for better multi-user playback performance ([Invidious installation, advanced configuration](https://docs.invidious.io/installation/#advanced-improve-performance)).
- Independent clusters with different egress providers/regions can survive a single IP block or deployment outage. They will often fail together when YouTube changes extraction, attestation, or policy.

**Proxy verdict:** Multiple user-configured resolver+relay clusters can materially improve instance and egress availability while preserving full DJ mode. Prefer Invidious+Companion, with Piped as an independent adapter; do not hardcode public instances. This remains a relay-backed and provider-policy-conflicting route, and provider-wide extraction changes can break every cluster together.

### Bandcamp: no supported custom-streaming path was found

Bandcamp’s published API is for labels and merchandise fulfillment partners and exposes account, sales-report, and merch-order operations; it does not document a catalog playback/stream API ([Bandcamp API](https://bandcamp.com/developer)). Bandcamp’s supported third-party playback surface is its embedded player ([Bandcamp embed help](https://get.bandcamp.help/en/articles/15263071-how-do-i-create-a-bandcamp-embedded-player)). Its terms describe streaming through the service and restrict content use to personal, non-commercial use unless separately permitted ([Bandcamp Terms](https://bandcamp.com/terms_of_use)).

The repository’s parser depends on public page JSON-LD plus the undocumented `data-tralbum` shape and extracts `bcbits.com` MP3 URLs; the relay supplies a Bandcamp referer. More relay instances would improve only relay availability. They would not stabilize page shape, CDN authorization, preview rules, or the absence of a supported playback contract.

Maintained resolver choices exist. yt-dlp supports Bandcamp and received a Bandcamp fix in its June 2026 release; `patrickkfkan/bandcamp-fetch` `v3.2.1` is an active MIT TypeScript alternative that exposes preview stream URLs without requiring Puppeteer for track/album resolution ([yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases), [bandcamp-fetch](https://github.com/patrickkfkan/bandcamp-fetch)).

The transport remains the blocker. A live `t4.bcbits.com` preview returned `206` and `Accept-Ranges: bytes` but no `Access-Control-Allow-Origin`; the Bandcamp page also omitted CORS. Plain media playback can work, but the existing `MediaElementAudioSourceNode` will be CORS-tainted and cannot honestly preserve DJ mode.

**Proxy verdict:** Use yt-dlp or bandcamp-fetch for metadata/resolution, then a user-configured byte relay that adds CORS and preserves Range. No maintained Bandcamp-specific end-to-end proxy was found, and Cobalt does not support Bandcamp. The current avoid.quest Bandcamp relay remains only until that BYO relay contract is working.

### Radio Garden: decouple directory discovery from station transport

The repository calls Radio Garden’s site-internal `/api/search`, `/api/ara/content/channel`, and `/api/ara/content/listen/.../channel.mp3` endpoints. Radio Garden publicly presents itself as the operator of a curated collection of over forty thousand stations and provides station submission/business contact surfaces, but no public developer interface or stability contract was found ([Radio Garden information](https://radio.garden/settings/radio-garden), [Radio Garden contact](https://radio.garden/settings/contact)). Treat the current adapter as undocumented and replaceable.

Live checks on 2026-07-10 showed why a tiny control plane remains useful. Radio Garden's search/metadata and listen redirect allowed `https://radio.garden` and localhost origins but did not return CORS permission for `https://avoid.quest`; behavior also varied by user-agent behind its WAF. The NTS1 listen route returned `302` to the NTS station stream. Loading that Radio Garden redirect chain directly is not a dependable Web Audio route because a CORS failure on an intermediate response can taint/fail the media request even when the destination grants CORS. A server resolver can follow the small redirect, validate it, and return the final station candidate without carrying audio bytes.

Once the final candidate is known, the normal direct/CORS/HTTPS decision applies to the station origin. Radio Garden remains one centralized mapping/search/resolve failure domain; the station is a second, independent failure domain. Running several avoid.quest resolvers does not make the Radio Garden dependency independent.

For an open alternative, Radio Browser explicitly allows direct use, self-hosting, mirroring, and forking. Its official client guidance says to discover servers through DNS, randomize them, retry the next server on failure, and use stable UUIDs rather than server-local IDs ([Radio Browser network guidance](https://api.radio-browser.info/)). The public metadata API currently grants wildcard CORS ([server source](https://gitlab.com/radiobrowser/radiobrowser-api-rust/-/blob/master/src/api/mod.rs#L69)), so browser clients can call it without an avoid.quest proxy. Its `url_resolved` field unwraps redirects and M3U/PLS/ASX playlists for browser clients; `hls`, codec, bitrate, HTTPS filtering, and majority-vote health fields are useful candidate signals ([Radio Browser API reference](https://docs.radio-browser.info/)). They are not proof of current browser compatibility.

### Radio Browser audit of the ten built-in stations

The audit used exact URL lookup first, then name/homepage/stream-identity matching. It found 4 exact records and 4 credible identity matches; the results expose both the value and the limit of the directory:

| Built-in | Radio Browser result | Decision |
| --- | --- | --- |
| Sygma | No record | Keep current direct URL; browser-probe it |
| LYL | Exact UUID `e11c170a-474f-11e9-aa55-52543be04c81`; healthy at 2026-01-15 check | Adopt UUID as refresh identity, but probe the returned URL live |
| Cashmere | Exact UUID `20c914bb-ac6f-4bad-8576-7bd269d97d43`; healthy at 2026-01-14 check | Adopt UUID as refresh identity, but probe live |
| NTS1 | Exact UUID `a3dbc189-d23e-4308-803f-5aad26432b8c`; a `?client=direct` equivalent was checked 2026-06-18 | Prefer the freshest equivalent candidate after identity and browser checks |
| NTS2 | Equivalent UUID `9529d080-19fb-42bd-8f1d-ec1a58c57723` with `?client=direct`; healthy 2026-06-18 | Candidate is credible, not an exact replacement |
| Radio BlackOut | Same-homepage alternative UUID `1e59fac5-fb91-463e-a725-05eb5890453c` points to an OGG stream; healthy at January check | Useful alternate, but both observed endpoints lacked CORS and still require relay/station fix |
| Resonance Extra | Exact UUID `d9e327ff-2c59-4145-83a9-67f7b33a1ab2`; healthy at 2026-01-15 check | Adopt UUID as refresh identity, but probe live |
| Internet Public Radio | Same-homepage alternatives point to `c11.radioboss.fm:18270/stream`; marked healthy in January, but the live audit timed out | Do not auto-swap from the current working URL |
| Radio Alhara | Identity matches contain HTTP and an already stale short-lived token | Reject directory candidate; keep resolving from a trusted fresh source |
| Gatto Misterioso | No record/name match | Keep current URL only if live probe succeeds |

Only one named mirror was discoverable through `all.api.radio-browser.info` during this snapshot, despite the protocol supporting mirror failover. Most matching station checks were from January 2026. Radio Browser should therefore be a **candidate discovery and refresh source**, never the source of truth for CORS or present reachability. Every selection still needs the same bounded browser media/CORS probe, and a known-good current URL must not be replaced by an older merely “healthy” directory value.

Recommended route:

- Make direct user station URLs canonical.
- Add Radio Browser as the primary replaceable directory adapter, using its published mirror discovery and UUIDs.
- Keep Radio Garden only as a server-side metadata/redirect resolver while it works, or seek a business integration; never relay station audio merely because it came from Radio Garden.
- Probe and remember full-DJ compatibility per final station URL/host, with a bounded TTL; station URLs can change, so refresh from the directory on failure.

**Proxy verdict:** Multiple directory mirrors improve search/resolution. Only a direct CORS-capable station or an audio relay solves the Web Audio path.

### Arbitrary radio, direct audio, and HLS

This is the strongest match for the product statement “the user chooses a source and the app provides tools.” The protocol decision should be per resolved stream, not per directory/provider:

1. Same-origin/blob/device: full DJ.
2. HTTPS plus successful CORS read: direct full DJ.
3. HTTPS HLS whose complete request graph is CORS-readable: direct full DJ.
4. Public HTTP or non-CORS stream: relay-required full DJ.
5. Unsupported codec, DRM/key system, or authentication that cannot safely be delegated: require a compatible external route or reject; never create a partial deck.

Ask owners of built-in stations to serve HTTPS and `Access-Control-Allow-Origin` for media. That is the only solution that is simultaneously browser-native, scalable, and removes avoid.quest from the audio path.

## Do multiple/failover proxies help?

Yes, under a precise model:

| Failure | Multiple independent proxies help? | Required behavior |
| --- | --- | --- |
| One deployment/region outage | Yes | Health-aware failover |
| One egress IP blocked | Yes | Different providers/IP pools; re-resolve after switching |
| URL bound to resolver IP | Only if resolution and bytes are sticky | Keep a deck on one resolver+relay cluster |
| Expired signed URL | No by itself | Re-resolve canonical provider ID |
| Provider-wide extractor/attestation change | Usually no | Update adapter; circuit-break provider |
| Final station is offline | No | Try an alternate station URL if the directory supplies one |
| Missing CORS on direct source | No | Relay bytes or have origin add CORS |
| Platform terms prohibit the use | No | Change product behavior/source |
| HLS child requests lack CORS | Only with a real HLS relay | Rewrite and relay every referenced resource |

Failover must happen between **independent failure domains**, not aliases for one origin. Use per-provider health and a circuit breaker, but keep a deck sticky while a leased/IP-bound stream is playing. Recovery receives the prior prepared source, marks that route unhealthy, and re-resolves rather than copying an old media URL to a new relay.

## Relay design: safe and scalable minimum

### Do not operate an open `?url=` proxy

Use two steps:

1. `POST /prepare` accepts a canonical user/provider reference under the app session. It normalizes, validates, resolves, tries direct CORS, chooses a relay only when necessary, and returns a short-lived signed playback capability.
2. `GET /relay/<ticket>` verifies the capability and streams only the exact normalized destination/host set, method, range budget, session, and expiry authorized by preparation.

The ticket should bind a URL hash or encrypted normalized URL, allowed redirect-host policy, expiry, route/provider, maximum bytes/duration/range, and session. Never forward browser cookies, arbitrary authorization headers, or user-supplied upstream headers. Revalidate every redirect and every DNS result; reject loopback, private, link-local, multicast, metadata, non-HTTP(S), credentials in URLs, and unexpected ports/content. OWASP recommends public IP checks for both IPv4 and IPv6 and explicit redirect handling for arbitrary-destination SSRF ([OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html#available-protections-1)).

For HLS, the ticket authorizes a manifest tree, not one URL. The relay must parse manifests, resolve relative URIs, validate each child, and rewrite child playlists/segments/maps to fresh scoped relay URLs. Reject DRM/encryption schemes the product does not intentionally support; never create a general key proxy.

### Scaling on the current Cloudflare runtime

Cloudflare Workers can stream a response without buffering it and recommends forwarding an upstream body verbatim when possible ([Workers Streams documentation](https://developers.cloudflare.com/workers/runtime-apis/streams/)). Current Workers limits include 128 MB memory, six simultaneous outgoing connections per invocation, no enforced response-body limit, and no hard HTTP wall-time limit while the client remains connected ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). The current paid model does not add Workers data-transfer/throughput charges, though request and CPU charges still apply ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)). These platform economics can change and should not be mistaken for a provider/content license.

Operational rules:

- Stream, never buffer or transcode.
- One upstream per progressive/live relay request; bound range requests and close on client disconnect.
- Do not cache provider audio. SoundCloud expressly permits only session-based caching necessary for operation and requires it to disappear at session end ([SoundCloud API Terms](https://developers.soundcloud.com/docs/api/terms-of-use#caching-and-downloading)).
- Apply per-session, per-IP, per-destination-host, and global concurrency/byte budgets. Cloudflare rate-limiting rules are designed to cap API/resource abuse and can count by client and resource characteristics ([Cloudflare rate-limiting guidance](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)).
- Keep provider allowlisted relays separate from the generic radio relay, because their threat models and upstream headers differ.
- Prefer direct redirects only after browser-origin CORS eligibility is known; HTTPS alone does not imply Web Audio readability.

### Observability

Measure the user-visible source pipeline, not only HTTP 5xx:

- `prepare_total` and latency by provider, adapter, and outcome.
- direct probe outcomes: CORS, HTTPS/mixed-content, content type, redirect count.
- selected route: direct, provider relay, generic relay, user relay.
- time to metadata, media ready, first sound, and buffer recovery.
- playback fatal error by stage: resolve, manifest, segment, media/decode, expiry, relay.
- refresh/failover attempts and successful recovery.
- relay active streams, bytes, duration, range sizes, client disconnects, upstream status, and limit terminations.
- circuit-breaker state and health by provider/route/failure domain.

Use opaque provider/item hashes and request IDs; never log signed URLs, query tokens, cookies, authorization headers, or raw user URLs. Cloudflare Workers provides request/error/CPU/subrequest metrics, logs, traces, GraphQL metrics, and custom Analytics Engine events; Analytics Engine writes are non-blocking ([Workers observability](https://developers.cloudflare.com/workers/observability/), [Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)).

## The radically minimal deep module

### Seam and interface

Place one external seam between user/provider references and `PlaybackSource`: a `FullDjSources` module with one interface method, `prepare`.

```ts
type Provider =
  | "bandcamp"
  | "radiogarden"
  | "soundcloud"
  | "youtube";

type DjAudioReference =
  | { kind: "url"; url: string }
  | {
      kind: "provider";
      provider: Provider;
      canonicalUrl: string;
      itemKey?: string; // playlist track/video ID; never a media URL
    };

type PlaybackInput = {
  src: string;
  format: "progressive" | "hls";
};

declare const preparedSource: unique symbol;

type PreparedDjSource = {
  input: PlaybackInput;
  mediaPath:
    | "direct"
    | "avoidquest-relay"
    | "external-relay";
  attribution?: {
    provider: Provider;
    creator?: string;
    sourceUrl: string;
  };
  readonly [preparedSource]: unknown; // opaque recovery/failover state
};

type PlaybackFailure =
  | "cors"
  | "expired"
  | "network"
  | "media";

type PrepareRequest =
  | { kind: "initial"; reference: DjAudioReference }
  | {
      kind: "recover";
      previous: PreparedDjSource;
      failure: PlaybackFailure;
    };

type PrepareError = {
  code:
    | "unsupported"
    | "not-playable"
    | "not-full-dj-capable"
    | "temporarily-unavailable"
    | "aborted";
  message: string;
  retryable: boolean;
  provider?: Provider;
};

type PrepareResult =
  | { ok: true; source: PreparedDjSource }
  | { ok: false; error: PrepareError };

type FullDjSources = {
  prepare(
    request: PrepareRequest,
    options?: { signal?: AbortSignal }
  ): Promise<PrepareResult>;
};
```

This is deliberately one entry point. Initial load and recovery share the same ordering, policy, health, and telemetry. The opaque member lets the implementation remember provider IDs, URL leases, attempted routes, and relay affinity without exposing them to callers.

### Interface invariants

Callers and tests need to know only these facts:

1. `ok: true` means `input` is intended for the existing Web Audio graph, not transport-only playback.
2. `src` is blob/same-origin, direct HTTPS with confirmed CORS eligibility, or a scoped relay URL. It is never an unresolved `yt:` token or a raw HTTP URL. `mediaPath` makes the privacy/bandwidth/trust boundary honest to UI and telemetry.
3. `format` is explicit because signed/resolved URLs do not reliably retain `.m3u8` extensions.
4. The module always tries permitted direct playback before relay.
5. `recover` never reuses an expired URL on a different failure domain. It re-resolves from the opaque canonical identity and excludes/penalizes the failed route.
6. Abort is an ordinary result. Unexpected programmer errors may throw; provider/network outcomes do not.
7. The module returns `not-full-dj-capable` rather than silently loading an embed or a media element that will produce silence.
8. Provider policy is fail-closed. A disabled or prohibited adapter cannot be re-enabled by a URL shape.

### Ordering hidden by the implementation

`prepare(initial)` performs, in order:

1. normalize and detect the reference;
2. apply provider/product policy and content-access flags;
3. resolve metadata and fresh candidate transports;
4. reject HTTP direct, blocked/DRM/unsupported candidates, and unsafe redirects;
5. attempt same-origin/blob or browser CORS-readable direct candidates;
6. if allowed, issue a provider-specific relay capability, then a configured user relay, then the generic bounded radio relay;
7. return a prepared source or one stable error.

`prepare(recover)` classifies the failure, invalidates the relevant URL lease/CORS cache/route health, preserves required IP affinity, re-resolves, and selects the next healthy candidate. Callers do not know which provider needs a token refresh, which relay must remain sticky, or which HLS tree needs rewriting.

### Usage

```ts
const prepared = await fullDjSources.prepare(
  { kind: "initial", reference },
  { signal }
);

if (!prepared.ok) return surfaceSourceError(prepared.error);

await playbackSource.load(prepared.source.input.src);

// On a classified fatal playback error:
const recovered = await fullDjSources.prepare({
  kind: "recover",
  previous: prepared.source,
  failure: "network",
});
```

The first implementation can pass `input.src` to today’s `PlaybackSource.load(string)`. A later narrow change should make that method accept `PlaybackInput`, removing filename-based HLS guessing without widening the provider seam.

### Hidden implementation and internal adapters

The `FullDjSources` module earns **depth** by hiding provider detection, normalization, unofficial resolution, metadata, candidate selection, CORS probes, signed-URL lifetime, relay selection, HLS handling, IP affinity, health/circuit breakers, failover, policy, and telemetry behind one interface.

Its implementation can use internal adapters:

- `ProviderResolver` adapters: direct URL, Radio Browser, Radio Garden, yt-dlp SoundCloud/Bandcamp, Invidious, and Piped.
- `RelayIssuer` adapters: transitional avoid.quest relays and user-supplied radio/Bandcamp/YouTube relays. This is a real seam because multiple adapters actually vary.
- Browser CORS probe and deterministic test fake.
- Route-health/clock/telemetry dependencies accepted by the module rather than created by callers.

These are internal seams, not additions to the external interface. Provider-specific types, `client_id`, Invidious options, proxy routes, host allowlists, and retry loops remain local to the implementation.

The module creates **leverage** because initial deck load, playlist advance, stream refresh, single-player mode, and tests use the same capability decision. It creates **locality** because a SoundCloud migration, YouTube disablement, relay change, or CORS rule changes in one implementation rather than across provider packages, DJ workflows, and `MediaElementPlaybackSource`.

The deletion test supports this placement: deleting the module would redistribute provider policy, direct probing, relay URL construction, expiry recovery, and failover across every caller. That complexity is exactly what the module should absorb.

### Tradeoffs

- Returning a result union adds one branch at each call site, but makes expected provider failures explicit and testable through the same interface.
- The opaque prepared source is stateful enough for safe recovery while avoiding a public provider state machine.
- The module intentionally excludes local files and device inputs; those already have good browser-native adapters and should not learn provider transport policy.
- Transport-only embeds are outside the chosen product direction. Adding them to this interface would weaken the `PreparedDjSource` invariant and make every DJ caller reason about silent graphs.
- Do not export every internal adapter interface. One adapter is a hypothetical seam; only variation that exists in production or tests should become an adapter.

## Implementation shortlist

### Ship in the web app

1. Put `FullDjSources.prepare` before the existing graph and classify every result as `direct`, `avoidquest-relay`, or `external-relay`.
2. Attempt a real browser CORS media load for plain HTTPS audio before using `/api/stream-proxy`; cache the result briefly per final origin/URL shape.
3. Make direct station URLs canonical and add the Radio Browser UUID/mirror adapter for discovery and refresh. Retain Radio Garden only as a small replaceable server resolver until there is a supported integration.
4. Fix/replace built-ins that are offline, stale, HTTP, tokenized, or non-CORS; ask station operators for HTTPS plus media CORS before accepting permanent relay cost.
5. Keep the current avoid.quest relays only as migration fallbacks until every current source has a proven direct or external-relay route; then remove them.

### Offer as explicit opt-ins

1. Define one BYO relay handshake that declares progressive/HLS support, allowed origins, Range semantics, maximum stream duration, and a health endpoint. A configured adapter must pass live CORS, `206`/`Content-Range`, cancellation, redirect, and HLS-child conformance tests.
2. Recommend MediaMTX for user-operated fixed HLS/restreaming and a radio-specific Corsfix fork for progressive generic relay; neither is a universal provider resolver.
3. Keep Invidious+Companion or Piped behind an experimental user-supplied-endpoint flag. Keep the resolver and relay on one instance/egress and re-resolve on failover.
4. Use yt-dlp only behind a thin user-configured resolver endpoint. A desktop/native companion is outside the browser/PWA product boundary.

### Do not build around

- Random public proxy instances, CORS Anywhere, a remote multi-tenant yt-dlp wrapper, or a P2P relay mesh.
- Silent capability degradation. Show `Full DJ`, `external relay required`, or `unsupported` before deck load; an accepted deck always enters the complete graph.
- Proxy fleets as a substitute for a supported provider contract. They address some infrastructure failures, not provider-wide extraction changes, CORS at a final direct origin, or platform policy.

## Recommended sequence

1. Introduce `FullDjSources.prepare` and route current behavior through it without changing the DSP graph.
2. Move direct CORS eligibility to the browser and try direct plain media before `/api/stream-proxy`.
3. Add browser-direct Radio Browser search and UUID refresh; retain Radio Garden through a tiny replaceable metadata/redirect resolver.
4. Add a thin user-configured yt-dlp resolver and prove SoundCloud cross-egress CORS/Range playback before moving it off the current proxy.
5. Define and conformance-test the BYO relay protocol, then integrate Invidious+Companion/Piped for YouTube and a scoped Range-preserving relay for Bandcamp/non-CORS radio.
6. Keep current avoid.quest relays during side-by-side verification, then remove each route only after its direct/external replacement preserves the complete graph and recovery behavior.
7. Add provider/route/failure-domain metrics and run a production compatibility probe over the actual station catalog before removing the final fallback.

The desired end state is not “one perfect proxy per platform.” It is **one deep source-preparation module, direct audio by default, user-configured relays for the irreducible tail, no avoid.quest audio data plane, and the complete DJ graph for every accepted source**.
