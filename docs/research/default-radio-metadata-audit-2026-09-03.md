# Default radio metadata audit, 2026-09-03

Observed from 2026-09-03 15:54:48 to 16:03:19 UTC, 17:54 to 18:03 Europe/Rome. HKCR was observed at 23:55 Hong Kong time. Results are a live snapshot, so programme titles will change and a missing programme can mean a genuine off-air window.

Only the repository and first-party station sites, APIs, and stream headers were used. The default list comes from [`const.ts`](../../apps/radio/src/lib/const.ts). The normalized field called `stationDescription` currently carries either station copy or a current programme description, depending on the provider; the table distinguishes station-only copy from useful current-item copy.

## Repository state

The matrix records the working tree as observed during the audit, including the uncommitted provider work that was already present. Compared with `HEAD`, that work added HKCR schedule lookup, Sygma artwork enrichment, Cashmere episode enrichment, and IPR search enrichment in [`external-providers.ts`](../../apps/radio/src/lib/metadata/external-providers.ts). Those additions are marked `WT`.

The initial implementation added dedicated providers, conservative enrichment, station names, and a validated non-`none` metadata strategy for every default. That wiring did not establish complete enrichment. A September 4 follow-up found additional first-party data that the providers never requested, documented below. Missing fields must be checked against the station's current sources before classifying them as upstream limitations.

`Actual item` means a page for the programme or episode that is currently playing. A resident, series, or station page is not counted as an actual item.

| Default radio | Title | Artist or host | Artwork | Actual item | Station name | Description | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sygma Radio | Yes | Not structured upstream | Yes, WT | Yes, episode | No | Available upstream, not normalized | Partial |
| LYL Radio | Intermittent; often only `Live` | Intermittent | No | No | Yes while `/live` exists | Station-only | Incomplete |
| Cashmere Radio | Yes | Archive only | Conditional, WT | Conditional, WT | No | No | Incomplete |
| NTS Channel 1 | Yes | Yes | Yes | Yes, episode | No | Yes | Complete except station label |
| NTS Channel 2 | Yes | Absent in sampled upstream item | Yes | Yes, episode | No | Yes | Complete except station label |
| Radio BlackOut | Yes | Not structured upstream | Yes | Yes, show | No | Yes | Complete except station label |
| Resonance Extra | Wrong under generic ICY parsing | Wrong | No | No | Yes | Station-only | Broken mapping |
| Internet Public Radio | Yes | No | Resident fallback, WT | No; resident fallback only | No | No | Incomplete |
| HKCR | Off-air in snapshot; scheduled lookup works in WT | Scheduled resident | Scheduled art | No; resident fallback only | Yes | Scheduled description | Upstream-limited |
| Radio Alhara | Track only; richer episode title ignored | Wrong | No | No | Wrong mount identifier | No | Incomplete |

## Prioritized confirmed gaps

### 1. Resonance Extra: use its programme API

The configured ICY stream emitted `Summer 2026 # Works for Radio - Resonance EXTRA`. The generic artist-title split therefore reports `Summer 2026 # Works for Radio` as the artist and `Resonance EXTRA` as the title.

The station's [`current_show_query`](https://x.resonance.fm/current_show_query) returned the correct programme title and the episode path `/episodes/summer-2026-works-for-radio-2026-09-03`. [`/api/episode/{slug}`](https://x.resonance.fm/api/episode/summer-2026-works-for-radio-2026-09-03) supplies `host`, `series_name`, `series_link`, `description`, start/end times, and `backgrounds[].image`. The actual public item was the corresponding [Resonance Extra episode](https://extra.resonance.fm/episodes/summer-2026-works-for-radio-2026-09-03). A dedicated provider can fill every missing field and keep ICY as fallback.

### 2. LYL Radio: reconcile on-air state with the official calendar

[`status-json.xsl`](https://icecast.lyl.live/status-json.xsl) first exposed `/live` with `server_name="LYL Radio"`, `server_description="We are the rest!"`, and a generic `LYL Radio - Live` title. It later returned `503`, then recovered without the `/live` mount, causing the current source selector to return no metadata.

The official [`strapi.lyl.live/graphql`](https://strapi.lyl.live/graphql) schema used by the site exposes `onair { title hls }` and `calendar(from,to) { start end title slug artists type }`. The sampled current `EPISODE` was `Tread on a Snake`, artist `Hermeneia`, slug `tread-on-a-snake-2`. `episodeBySlug` adds `description`, `image.url`, `styles`, and `show.slug`; the [actual episode page](https://lyl.live/episode/tread-on-a-snake-2) was live.

Calendar entries can overlap and `onair.title` became null when the live mount disappeared. The provider should require a positive on-air signal, match the current `EPISODE` window, and fail honestly rather than selecting the first calendar entry.

### 3. Radio Alhara: replace the obsolete metadata source

The configured RadioJar stream emitted `Radio Alhara - Dimkal` and the machine mount name `78cxy6wkxtzuv`. The generic parser turns `Radio Alhara` into the artist and exposes the mount ID as the station name.

The [official site](https://www.radioalhara.net/) now uses `https://stream.radioalhara.net/ra` and polls its first-party [`/api/now-playing`](https://ch2.radioalhara.net/api/now-playing). The sampled JSON provided `title="Dimkal"`, `episodeTitle='DIMKAL pres. "UNCOMPROMISING EXPRESSIONS"'`, `episodeId`, `airDate`, `mode`, `trackStart`, `duration`, `scheduledTitle`, and rerun state. This fixes the display title and mode, but the API and site expose no public item URL, artwork, or description for that `episodeId`. Those fields should remain null unless the station adds a documented mapping.

### 4. Cashmere Radio: finish conditional episode and live-show enrichment

During archive playback, [`live-info-v2`](https://cashmereradio.airtime.pro/api/live-info-v2) returned `Yaps n’ Wubz by DJ flintapiss | Piss #14` with an artist but no URL, artwork, or description. The official WordPress [search endpoint](https://backstage.cashmereradio.com/wp-json/wp/v2/search?search=Yaps%20n%20Wubz%20by%20DJ%20flintapiss%20Piss%2014&per_page=10&subtype=episode) identified episode `32890`; [`/episode/32890?_embed=1`](https://backstage.cashmereradio.com/wp-json/wp/v2/episode/32890?_embed=1) supplies `slug`, `content.rendered`, `featured_media`, ACF genre/mood, and Mixcloud data. The [public episode](https://cashmereradio.com/episode/yaps-n-wubz-by-dj-flintapiss-piss-14/) is the actual item.

The WT GraphQL enrichment already adds an exact-match episode URL and artwork. It does not add the episode description or genres. When a live slot began, Airtime exposed [The Poetry Hotline show URL](https://cashmereradio.com/shows/the-poetry-hotline-w-amanda/) but no artwork or description; that first-party page's Open Graph image and description can fill those fields when episode search has no exact result. Keep exact or unique matching and do not accept the first fuzzy search result.

### 5. Internet Public Radio: distinguish an actual episode from a resident fallback

The first-party [Airtime-compatible feed](https://stream-relay-geo.internetpublicradio.live/api-filtered.php) returned only `Memory Archive w/ FDG (R)` plus the date-like comment `02.04.24`. No artist, artwork, item URL, or description was present.

The official [`/api/search`](https://www.internetpublicradio.live/api/search?q=Memory%20Archive%20FDG), backed by Sanity project `7rbo2iih`, dataset `production`, returned one resident and two same-titled episodes with slugs, dates, and image references. Public episode routes are `/{residentOrSeriesSlug}/episodes/{episodeSlug}`; guest episodes use `/guests/episodes/{slug}`. The feed date did not match either indexed episode, so the current replay cannot be identified safely. The WT enrichment selects the [resident page](https://www.internetpublicradio.live/residents/memory-archive-w-fdg) and its artwork. That is a useful fallback, but it must not be presented as the actual episode URL. Only emit an episode item when a stable date or another unique key disambiguates it.

### 6. Sygma Radio: add the remaining episode fields

[`stats-icecast.json`](https://radio.syg.ma/stats-icecast.json) returned `tracks.current.metadata.track_title="GUESTS 141 – Oleg Kortunov"` and `info_url="guests-141-oleg-kortunov"`; artist, artwork, and description were empty. The existing slug mapping correctly produced the [actual episode page](https://radio.syg.ma/episodes/guests-141-oleg-kortunov), and the WT enrichment now obtains its artwork.

The page's `__NEXT_DATA__.props.pageProps.data` also contains `description` and `picture.url`. Its data URL has the volatile form `/_next/data/{buildId}/en/episodes/{slug}.json`, so scraping a stored build ID would be brittle. The first-party [backend episode JSON](https://backend.radio.syg.ma/episodes/guests-141-oleg-kortunov.json) exposes the same `description`, `picture.url`, `title`, and `slug` without a build ID. It is the cleaner enrichment source. No structured host is present in the live response.

## Complete or upstream-limited stations

- [NTS live API](https://www.nts.live/api/v2/live) provided broadcast title, details link, description, artwork, and genre for both channels. The generated [Channel 1 episode](https://www.nts.live/shows/trevorjackson/episodes/trevor-jackson-19th-march-2020) and [Channel 2 episode](https://www.nts.live/shows/the-nts-guide-to/episodes/the-nts-guide-to-cowpunk-23rd-september-2025) both returned `200`. Add static channel station names; the sampled Channel 2 payload had no separate host, so null is accurate.
- [Radio BlackOut listening API](https://radioblackout.org/api/listening) provided the current title, excerpt, featured image, and the actual [Cosmic Mamba show](https://radioblackout.org/shows/blackmamba/). Add the static station name. The source did not expose a structured host.
- [HKCR current schedule](https://cms.hkcr.live/schedule/current) had no entry covering 23:55 HKT. This alone did not establish an off-air window: the initial audit missed the separate replay schedule used by HKCR's frontend. Scheduled entries provide title, resident, description, and picture/thumbnail, but every sampled current entry had `show: null`. Entries with a show ID can resolve their full record through `GET https://cms.hkcr.live/shows/{id}`.

## Assignment order

1. Resonance Extra dedicated provider.
2. LYL on-air/calendar provider with outage handling.
3. Radio Alhara official now-playing provider.
4. Cashmere archive and live-show enrichment completion.
5. IPR safe episode matching and explicit resident fallback semantics.
6. Sygma description enrichment.
7. Static station-name fill for Sygma, Cashmere, NTS 1/2, Radio BlackOut, and IPR.

## Follow-up, September 4

An independent sweep traced all ten curated stations through their configured provider and compared the results with current first-party sources. All ten were already wired. Four provider omissions accounted for missing published enrichment:

- **HKCR:** `/schedule/current` omitted an active replay. The site's frontend also requests [`/replay-slots/range`](https://cms.hkcr.live/replay-slots/range?startDate=2026-09-04&endDate=2026-09-05). The 13:00–14:00 UTC slot identifies show `6897aaf312134072c4dd1686`; its [show record](https://cms.hkcr.live/shows/6897aaf312134072c4dd1686) supplies the title, resident, artwork, description, genres, and public slug. The provider needs both live and replay schedules, with current-window and show-ID checks.
- **Cashmere:** the live title `Circles in Space by Radiocircolo 13.05.2026.mp3` did not match an indexed episode. A unique exact [show page](https://cashmereradio.com/shows/circles-in-space-by-radiocircolo/) publishes artwork and a description. Removing the filename suffix and terminal broadcast date permits a conservative show fallback without linking a different dated episode.
- **Internet Public Radio:** search results identified the dated `Idle Not Idle` episode and its artwork, but the provider never fetched the selected Sanity document's description. The selected record publishes "Randomness selections compiled by music collector from Porto, Diogo Ferreira." Sanity's [`pt::text`](https://www.sanity.io/docs/specifications/groq-functions) projects Portable Text into plain text without importing playback fields.
- **Radio BlackOut:** `/api/listening` supplies a truncated excerpt containing HTML entities. The matching [HARRAGA show record](https://radioblackout.org/wp-json/wp/v2/shows?slug=harraga) supplies full HTML content and tags. The existing Details panel displayed the encoded excerpt literally. Fetching the verified show record and normalizing its text fixes this without changing the UI.

Sygma, LYL, both NTS channels, and Resonance Extra returned current titles, artwork, public item links, and programme descriptions in the follow-up sweep. These observations do not guarantee every future broadcast has every field.

Radio Alhara's current [now-playing feed](https://ch2.radioalhara.net/api/now-playing) supplied the episode title, show title, and artist, with `episodeId: null` and no artwork, description, or public item URL. The [official frontend](https://www.radioalhara.net/) used those same fields and static station artwork. Those absent programme fields remain an observed upstream limit. Ambiguous or date-mismatched IPR episodes remain unlinked; a matching show must not be presented as an exact episode.

After the provider fixes, a separate live sweep ran every configured default through `createRadioMetadataRetrieval` and `createMetadataUpstreamFetch(fetch)`, including real DNS/redirect validation and the existing eight-second timeout. All ten returned their configured provider successfully. Nine returned artwork, a public item link, and a programme description; Alhara returned its available text fields. The four repaired paths returned descriptions of 253 characters for Cashmere, 77 for IPR, 692 for HKCR, and 1,191 for BlackOut. This validates the local implementation against live sources; deployed verification must identify the tested commit separately.
