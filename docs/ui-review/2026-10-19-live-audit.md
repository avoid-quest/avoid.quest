Live UI audit — 19 October 2026

Both apps run and their principal interfaces render. Before changing component primitives, address Node mode's mobile viewport/focus behavior, hit targets, and Radio's missing Geist setup. The existing neutral palette is reasonably coherent; the measurements do not establish widespread token chaos.

**Scope and evidence**

Audited the actual local development apps from `/Users/azeta/.t3/worktrees/avoid-quest/t3-8d5f3bad`, using T3's collaborative browser. Dependencies were already present, so no installation was necessary. Started `bun run --filter @avoid.quest/radio dev` at port 3000 and `bunx astro dev --port 3001` from `apps/web`. Both returned HTTP 200 to readiness curls. Read Radio's README, Vite config, env declarations, Wrangler config, route sources, and relevant shared styles. No Doppler login, deployment, feedback submission, tracked-source edit, or commit was performed.

Captured desktop **1440×900 CSS px** and mobile **390×844 CSS px**, with `dark` added/removed on `<html>`. Also exercised each app's actual theme control. T3 exports desktop images at 1280×800 and mobile at 780×1688; viewport measurements in JSON confirm the requested CSS sizes. Mobile means narrow desktop-browser viewport, not an emulated touch device or real phone. Desktop-only Feedback and What's new were opened before narrowing the viewport; those captures prove layout behavior, not mobile discoverability.

Full numbers: [measurements.md](/tmp/ui-audit/measurements.md), [metrics.csv](/tmp/ui-audit/metrics.csv), [metrics.json](/tmp/ui-audit/metrics.json). Every screenshot: [screenshots.md](/tmp/ui-audit/screenshots.md). Each main capture has a same-named JSON containing computed values, control lists, text, and browser diagnostics. [collect-metrics.js](/tmp/ui-audit/collect-metrics.js) contains the evaluated collector.

**Highest-priority findings**

1. **High — Node canvas is not fitted to mobile, and keyboard focus can disappear off-screen.** Reproduced both after desktop→mobile resize and after reloading at mobile width. The Track starts at x=211.5 with width 336, so much of it lies outside a 390px viewport; Speakers starts at x=667.5 and is entirely off-screen. Tab reaches the cable at x≈552 and Remove empty Track at x≈514 without revealing them. `scrollWidth > innerWidth` remains false because the canvas clips its contents. This needs explicit viewport/focus handling; replacing Radix will not fix it. Evidence: [cold mobile](images/radio-node-cold-mobile-dark.png), [Tab 10](images/radio-node-mobile-dark-focus-10.png).
2. **High — Dense controls are undersized across both apps.** Radio has 28×28 header buttons, 28px mode switches, 32px inputs/buttons, 14×14 reorder handles, 16×16 station checkboxes and volume thumbs. Single mode flags 40 geometric targets below 44×44 at mobile width; settings adds many more. Web's four destination links are 28px high and its footer controls 36×36. These are ergonomic findings against the requested 44px benchmark, not an assertion that every target violates a particular WCAG criterion.
3. **Medium — Radio does not load Geist.** Across its rendered routes the computed body family is `-apple-system, system-ui, Segoe UI, Roboto, …`, and `document.fonts` contains no loaded faces. Web computes `Geist Sans` and has loaded Geist Sans 400 and Geist Mono 400 faces, corroborated by successful font requests. Radio imports shared globals without Web's font imports/variable definitions, so a shared typography foundation is currently incomplete. [Radio](images/radio-single-desktop-light.png), [Web](images/web-home-desktop-light.png).
4. **Medium — Mobile hides discovery and station actions.** Radio's mobile header hides the Feedback and What's new buttons and mode text. Station-row Details/Options groups have computed opacity 0 at rest while occupying space. The player-level overflow remains visible, but per-row secondary actions are difficult to discover without hover/focus. Do not depend on desktop hover in a future touch UI. [Single mobile](images/radio-single-mobile-light.png).
5. **Medium, local-dev blocker — Legal assets are not prepared.** Radio `/legal` shows the error boundary because `/legal/build.json` returns 404. Web `/legal` renders its overview, but all six document URLs return 404. Both build scripts invoke `scripts/prepare-legal.ts`; the requested direct dev commands do not. This is a reproducible local setup limitation, not a demonstrated production failure. The generator writes into app directories, so it was not run under the `/tmp`-only artifact constraint.
6. **Medium — Radio error navigation contains a nested interactive control.** On `/legal`'s error screen, Tab visits the Go home anchor and then its child button as separate stops. Source confirms `<Link><Button>…</Button></Link>` in `apps/radio/src/components/root/root-error-view.tsx`. The generic error copy gives no explanation that local source metadata is missing. [Error screen](images/radio-legal-mobile-light.png), [focus sequence](/tmp/ui-audit/radio-legal-mobile-dark-focus.json).

**Radio: `/` — Single**

Renders ten stations, artwork and show metadata, a selected-station highlight, episode links, playback controls, search, and station menus. The desktop split layout is aligned and readable; on mobile the player moves above the independently scrolling station list. The 48×48 Play control is appropriately prominent. No page-level horizontal overflow was measured in either theme.

The list is visually cramped: names are around 14px, secondary metadata 12px and genre badges 9px. Long show titles truncate aggressively, especially when badges consume the same line. The main show title scales from 30px desktop to 18px mobile, a substantial hierarchy change but still readable. Some supplied station logos have weak contrast against their tile backgrounds (notably light Resonance artwork in light mode and dark logos in dark mode). Secondary borders/selected fills are subtle; selected text weight helps distinguish the active row.

Ten Tab steps were recorded on mobile: logo, playback group, selected mode, settings, artwork Details, episode link, Play, Mute, Volume, player Options. Most controls have visible rings; the extra focusable playback-group stop has no obvious focus treatment. Native labels for icon controls are generally good. The station overflow menu opens, supports ArrowDown/Escape, and separates Delete visually in red; destructive activation was not exercised.

Evidence: `/tmp/ui-audit/radio-single-{desktop,mobile}-{light,dark}.png`; [station menu](images/radio-station-menu-desktop-dark.png); [focus 10](images/radio-single-mobile-dark-focus-10.png).

**Radio: `/` — Node**

Renders an empty Track connected to Speakers, source search, Add, Templates, undo/redo, and a desktop Rack. The desktop graph has clear node labels and a visible cable; the large empty canvas emphasizes the small initial patch. Mobile removes the Rack and reduces toolbar labels. The clipping/focus issue above is the dominant problem. Several graph focus stops (edge and node group) have no ordinary outline or box shadow, and reaching off-screen descendants does not pan them into view.

Add opens a desktop dialog and a mobile bottom drawer with source cards and search. This is useful progressive disclosure, but the catalog is long and implementation badges such as `openDAW`/`radio` mix engine details into user-facing choices. “Radio episodes / shows” repeats the “Share audio from another browser tab” description, which does not explain the named feature. Sources are much easier to scan than the initial canvas is to understand on a phone. No source was added and no audio graph was changed.

Console includes React Flow's attribution/subscription warning. This records the warning only; subscription status was not investigated.

Evidence: `/tmp/ui-audit/radio-node-{desktop,mobile}-{light,dark}.png`; `/tmp/ui-audit/radio-node-add-{desktop,mobile}-{light,dark}.png`; [focus sequence](/tmp/ui-audit/radio-node-mobile-dark-focus.json).

**Radio: `/` — DJ**

Renders symmetric station decks A/B and a central desktop mixer. The A/B layout and fader direction are understandable. Tiny mixer captions/knobs pack much more information into the center than either side, creating a different density from Single mode. On mobile, the layout becomes a top crossfader/master section plus A/B deck tabs and one source list. This is a meaningful responsive adaptation with no page overflow.

Both decks begin “Empty,” but the page gives little immediate guidance beyond source search. Ten Tab steps reached header controls, crossfader, master volume, deck tab, platform selector, search and source tabs. Controls have useful accessible labels; the fader thumbs are narrow (20×36 crossfader and 14×28 master). Audio, cue hardware and actual mixing were not verified.

Evidence: `/tmp/ui-audit/radio-dj-{desktop,mobile}-{light,dark}.png`; [keyboard sequence](/tmp/ui-audit/radio-dj-mobile-dark-focus.json).

**Radio: `/` — Settings and nested dialogs**

Settings is a bottom drawer, not a `/settings` route. Radios opens by default; desktop uses a left tab rail, mobile a five-item horizontal tab strip. Rows align consistently and the station filter/Add station affordances are clear. On mobile, descriptions truncate, station management controls are very small, and the fixed Close footer competes with the scrolling list. General is much sparser than Radios inside the same tall drawer, leaving substantial unused space. General focus stays inside the drawer; a fresh Escape test closes it and restores focus to Open settings.

Playback renders permission guidance, Main output, delay, CUE and troubleshooting. MIDI renders permission guidance, an enable switch, device status, presets and a long mappings list. Data renders Export/Import/Reset and explicit local-storage explanation with Download backup/Create share link. Their grouping is sensible; MIDI requires a lot of scrolling, and disabled permission-dependent controls have subdued contrast. Permissions were not granted and import/reset/export actions were not activated.

Add station opens another modal over the drawer with Radio Garden / From URL / Manual tabs. Its search placeholder truncates on mobile, and stacking a centered modal over a bottom drawer creates overlapping visual layers and two different close patterns. Labels and introductory guidance remain readable. No station was created.

Evidence: `/tmp/ui-audit/radio-settings-{desktop,mobile}-{light,dark}.png`; `/tmp/ui-audit/radio-settings-general-{desktop,mobile}-{light,dark}.png`; [Playback](images/radio-settings-playback-mobile-dark.png), [MIDI](images/radio-settings-midi-mobile-dark.png), [Data](images/radio-settings-data-mobile-dark.png), [Add station](images/radio-add-station-mobile-dark.png).

**Radio: `/` — Feedback and What's new**

Feedback renders clear public-GitHub/privacy guidance, a labeled Message textarea, disabled empty Send feedback, Cancel and Close. The message field gets a visible focus ring; Tab cycles within the modal and Escape dismisses it. Mobile stacks actions coherently, but the close icon is only about 16×16 and the privacy paragraph dominates the small dialog. GET `/api/feedback` repeatedly returns 502 with `{"error":"issue_create_failed","ok":false}`. The documented optional credential is `GIT_FEEDBACK_GITHUB_TOKEN`; code returns this error when it is absent. The active binding value was not inspected, so missing configuration versus another endpoint failure is not proven. Submission was intentionally not attempted because it would create a public issue.

What's new renders dated entries in a bounded scrollable popover and a version footer. Typography and spacing are consistent with other utility surfaces, but lengthy technical entries are difficult to scan and some read like raw implementation notes. Its original trigger disappears at mobile width; opening on desktop then resizing can leave a detached popover over the upper-left screen. That is a resize-state issue, separate from the lack of an obvious mobile trigger.

Evidence: `/tmp/ui-audit/radio-feedback-{desktop,mobile}-{light,dark}.png`; `/tmp/ui-audit/radio-changelog-{desktop,mobile}-{light,dark}.png`; [Feedback keyboard sequence](/tmp/ui-audit/radio-feedback-mobile-dark-focus.json).

**Radio: `/import`, `/legal`, `/settings`, `/u/*`**

`/import` without a payload shows “Nothing to import,” a short explanation and Go home. It is a clean, readable empty state in both themes, though it offers no example or path to a valid import. Go home is 32px high. A valid import payload/success flow was not exercised.

`/legal` renders “Something went wrong,” Try again and Go home; source/license content could not be reviewed because generated metadata is missing. The error screen itself reflows without overflow, but has the nested Go home focus issue noted above. `/settings` correctly gives a not-found view: settings lives in the header drawer.

`/u/$.ts` is an Umami proxy, not a user screen/profile route. Curl GET `/u/script.js` returned 403 and `/u/not-a-real-route` returned 404. These are endpoint observations; no user-profile UI exists at this route. API routes, manifest, playlist and tunnel are not visual screens and were not treated as such.

Evidence: `/tmp/ui-audit/radio-import-{desktop,mobile}-{light,dark}.png`; `/tmp/ui-audit/radio-legal-{desktop,mobile}-{light,dark}.png`; [settings-route 404](images/radio-settings-route-404-mobile-dark.png).

**Web: `/`**

Renders the centered brand mark and four destination links, plus GitHub and theme controls at bottom right. Geist Sans/Mono actually load. The restrained palette, generous space and simple type scale are coherent in both themes. All four descriptions fit at 390px; no overflow was measured. The longest destination is close to the available width but still fits.

Destination names are not clearly differentiated from descriptions until hover, so the whole group initially reads like a list of text. The page has no visible heading explaining the collection, and no h1. Destination links open new tabs without an on-screen indication. Link rows are 28px high; footer icons are 36×36. Ten Tab steps traverse the six app controls, then Astro's development toolbar. The app links have clear native focus outlines, and the GitHub control has a visible ring. The dev toolbar at the bottom of screenshots is development tooling, not a production design defect.

The actual theme button changes the theme. Dark `<html>` still computes `color-scheme: normal`; native browser surfaces are not explicitly aligned with the dark theme. Class-forced Radio screenshots alone do not prove that defect there: Radio's actual Dark control correctly sets `color-scheme: dark`.

Evidence: `/tmp/ui-audit/web-home-{desktop,mobile}-{light,dark}.png`; [visible keyboard focus](images/web-home-mobile-dark-focus-1.png).

**Web: `/legal`, `/u/*`**

`/legal` renders a readable narrow column with Back, GitHub, a 24px heading, explanatory body copy and six document links. The mobile copy wraps cleanly. The links look like plain text at rest and are 28px high, reducing affordance and touch comfort. All six local document targets return 404 because the generated legal folder is absent; see [exact status list](/tmp/ui-audit/legal-link-status.json). Keyboard focus is visible through Back, GitHub, the six links and theme control. No new Web-origin console errors or hydration warnings were observed during these UI visits.

`/u/[...path].ts` is another Umami proxy, not a profile screen. The initial browser request for `/u/script.js` and its analytics send returned 200; separate curl requests for the script and an invalid path returned 403. Proxy behavior therefore differs by request context/upstream response. No profile UX can be audited here.

Evidence: `/tmp/ui-audit/web-legal-{desktop,mobile}-{light,dark}.png`; [keyboard sequence](/tmp/ui-audit/web-legal-mobile-dark-focus.json).

**Compact route/state measurements**

Each cell lists desktop / mobile, using the light capture. Dark values and every full row are in measurements.md. Font/radius/color/background figures count unique computed strings; all rows have zero unnamed candidates and no document overflow.

| State | Elements D/M | Font sizes D/M | Radii D/M | Colors D/M | BGs D/M | data-state D/M | <44px D/M |
|---|---:|---:|---:|---:|---:|---:|---:|
| radio-single | 406 / 406 | 6 / 6 | 8 / 8 | 8 / 8 | 9 / 9 | 30 / 30 | 42 / 40 |
| radio-node | 226 / 189 | 4 / 4 | 8 / 8 | 9 / 9 | 11 / 10 | 9 / 9 | 22 / 15 |
| radio-dj | 574 / 278 | 5 / 5 | 7 / 7 | 7 / 7 | 10 / 10 | 31 / 14 | 35 / 17 |
| radio-settings | 729 / 729 | 6 / 6 | 10 / 11 | 7 / 7 | 11 / 11 | 67 / 67 | 80 / 79 |
| radio-settings-general | 499 / 499 | 6 / 6 | 9 / 10 | 7 / 7 | 11 / 11 | 42 / 42 | 55 / 54 |
| radio-feedback | 428 / 428 | 7 / 6 | 9 / 9 | 8 / 7 | 10 / 10 | 32 / 32 | 45 / 43 |
| radio-changelog | 462 / 462 | 6 / 6 | 8 / 8 | 7 / 7 | 10 / 10 | 31 / 31 | 42 / 40 |
| radio-node-add | 862 / 823 | 5 / 4 | 10 / 11 | 14 / 13 | 18 / 17 | 11 / 11 | 24 / 16 |
| radio-import | 95 / 95 | 5 / 5 | 4 / 4 | 6 / 6 | 5 / 5 | 6 / 6 | 9 / 7 |
| radio-legal | 98 / 98 | 5 / 5 | 4 / 4 | 7 / 7 | 5 / 5 | 6 / 6 | 11 / 9 |
| web-home | 65 / 65 | 3 / 3 | 2 / 2 | 5 / 5 | 2 / 2 | 0 / 0 | 6 / 6 |
| web-legal | 62 / 62 | 3 / 3 | 2 / 2 | 4 / 4 | 2 / 3 | 0 / 0 | 9 / 9 |

**Visual foundations and performance**

Radio uses repeated 6/8/10/14px and pill radii, with asymmetric segmented-button corners. Web has only two computed radius values and three font sizes. These counts include hidden elements, SVGs and browser-generated control markup; they are not counts of authored design tokens. The useful overhaul work is to document intentional roles: compact desktop utility controls, touch targets, cards, drawers, pills, text hierarchy and focus rings. The neutral colors and successful light/dark inversion are worth retaining. Contrast remarks above are visual observations; a complete measured WCAG contrast audit was not performed.

The Add node surface grows the element count from 226→862 on desktop (189→823 mobile), and Radios settings retains background UI while growing Single's 406→729. Those are candidates for profiling if larger station catalogs or patches feel slow; no frame-time/heap/production-bundle measurements were taken. Radio's resource-timing buffer reaches its 250-entry cap in dev, while Web exposes about 24–25 entries. Vite module traffic and a full buffer cannot support a production load-time comparison. SSR-disabled Radio routes visibly pass through loading/skeleton states on cold navigation; settled captures replace those preliminary states.

Browser diagnostics were collected through T3 snapshots, not standalone Playwright `page.on` handlers. [diagnostics.json](/tmp/ui-audit/diagnostics.json) preserves the deduplicated observed console failures and available failed requests. Radio issues: feedback 502, legal metadata 404 and React error-boundary/route-match logs, plus the React Flow attribution warning. No hydration-mismatch warning was observed. T3 retains console history across navigation: an old Radio error appearing in a Web capture is not a new Web error. Console/network snapshots are bounded, so absence of a message is not a guarantee that every transient error was captured; there is no separately instrumented complete `pageerror` stream.

**What works well**

- Radio Single has a strong artwork/title/play hierarchy and a useful selected-station treatment.
- Single and DJ have deliberate mobile layouts, without page-level horizontal overflow.
- Most icon controls, inputs, sliders and switches have meaningful names; final main captures found zero unnamed visible button/link candidates after accounting for labels and SVG titles.
- Modal focus containment, Escape dismissal and settings focus restoration work in fresh tests.
- Both themes are visually coherent; Web's actual Geist font loading and visible keyboard focus are solid foundations.
- Permission explanations and local-data copy make otherwise technical settings understandable.

**Measurement definitions and remaining limits**

Unique style counts cover every light-DOM element from `querySelectorAll('*')`. “Elements” is the DOM element-node count, not text/comment nodes or shadow-root descendants. `data-state` is an attribute count, not proof of Radix ownership; Vaul and app markup can also use it. Unnamed checks use aria-label, aria-labelledby, native labels, text, image alt, SVG title and title; they are a practical heuristic, not a full accessible-name conformance engine. Small-target candidates include button/link/input/select/textarea, common interactive ARIA roles and tabindex=0, with positive geometry and non-hidden display/visibility. They include opacity-zero controls, off-screen elements, modal backgrounds, disabled controls and some 1px native-select proxies. Thus 79 in settings does not mean 79 simultaneously actionable visible targets. This was corroborated by specific control dimensions and the accessibility snapshots.

All matrix captures report no document-level horizontal overflow; the Node example demonstrates why that check alone is insufficient. Metadata changes over time, hover/focus and transition state can slightly change counts. Full four-state matrices cover the principal surfaces; Playback/MIDI/Data and nested Add station received supplemental mobile-dark captures, not a full theme/device matrix. Keyboard sequences record ten Tabs on Single, Node, DJ, import, the legal error, settings General, feedback, Web home and Web legal; main screenshots also capture other menus, but every possible widget/shortcut was not exhaustively exercised.

No credential was needed to start either app. Feedback availability remains blocked as described; secrets were not inspected or supplied. Missing generated legal assets prevented content review and live document navigation; generators were not run because they write outside `/tmp/ui-audit/`. Production builds, `bun run check`, typecheck and unit tests were skipped: this was a read-only live UI audit with no source change, and builds generate app artifacts. Audio playback fidelity, autoplay recovery, hardware outputs, microphone/MIDI permissions, import success, actual touch/virtual-keyboard behavior, screen readers, reduced motion and production deployment were not verified.

Both dev servers and their discovered child processes were terminated. No listeners remained on ports 3000/3001. [server-cleanup.json](/tmp/ui-audit/server-cleanup.json) records the PIDs. No tracked files were edited or committed. An untracked `docs/ui-review/` directory appeared during the session and was left untouched.

Checklist reference: [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), used alongside the requested live-rendering checks.
