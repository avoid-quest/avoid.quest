# Front-end/UI review

**Verdict:** this is a useful shared component collection, but it is not ready to become an independently consumed design system. The biggest risks are hidden package-resolution dependencies, custom interaction behavior embedded in nominally standard components, and visual conventions enforced through consumer overrides.

“Blocker” below means a blocker to safe extraction or regeneration, not necessarily a production failure.

This was read-only. All references were checked against the current files; accessibility findings are source-based, without browser or assistive-technology verification.

## 1. `packages/ui` architecture

The underlying structure is sensible: component subpath imports, CVA variants, a small `cn()` helper, semantic color variables, and wrappers around accessible primitives. The problem is that the package combines several different responsibilities.

- `package.json:7` exports raw TypeScript/TSX, CSS, hooks, utilities, and assets; there is no root barrel or build script.
- `components.json:3` declares `new-york`, neutral colors, CSS variables, Lucide, and package-local aliases. `rsc: true` is generator configuration; neither current consuming app is an RSC application.
- `tsconfig.json:2` inherits the workspace React-library configuration, which enables strict checking, `noUncheckedIndexedAccess`, and NodeNext resolution through `packages/config/base.json:13`.
- Most standard controls remain recognizable shadcn wrappers. `Slider`, `Dialog`, `Tooltip`, and `Card` need to be treated as locally maintained components.

### Custom component assessment

Paths in this table are under `packages/ui/src/`.

| Severity | Location | Why | Fix |
|---|---|---|---|
| **should-fix** | `components/knob.tsx:9` | The controlled numeric API is reusable, but it exposes nonstandard `ariaLabel`, permits an unnamed slider, lacks native attribute/ref forwarding, and offers no commit callback. | Keep it as an explicitly supported numeric-control component with a required accessible name, standard ARIA props, ref support, and documented change/commit semantics. |
| **should-fix** | `components/play-pause-button.tsx:9`, `:90` | It manually duplicates Button’s variant types, cannot accept ordinary button props such as `type` or `aria-describedby`, and forces `size-16` whenever `inline` is false regardless of its `size` prop. | Derive its props from Button and separate transport size from optional surrounding layout. |
| **should-fix** | `components/changelog.tsx:27`; `lib/changelog.ts:14` | This is a release-notification feature with persistence and unread-state policy, rather than a basic visual primitive, although its entries and storage key are correctly injected. | Move it into a documented feature subpath/package, or separate presentation from the storage controller. |
| **should-fix** | `components/legal-page.tsx:17`, `:30`, `:58` | The shared package hardcodes this repository, Radio’s openDAW licensing explanation, and application-owned `/legal/*` routes. | Move the content and routes into the apps or a product-content package; share only presentation if necessary. |
| **nice-to-have** | `components/site-logo.tsx:12`, `:18` | This is an avoid.quest brand lockup with fixed geometry, rather than an interchangeable design-system primitive. | Put it alongside brand assets and expose layout/size options only when consumers need them. |
| **should-fix** | `components/user-avatar.tsx:47`, `:64` | `fallback` is effectively ignored when `username` is absent because the initials function is only called inside the username branch. | Resolve fallback content independently of username, use `cn()` for class merging, and rely on Avatar’s image-status handling. |
| **nice-to-have** | `components/skeletons.tsx:7`, `:32`, `:46` | Post-card, posts-grid, and post-page skeletons encode a missing product’s layouts, and I found no current app consumers. | Remove these from the general API or move them with the feature that owns the layouts. |
| **nice-to-have** | `components/mode-toggle.tsx:12`, `:27` | It couples presentation directly to next-themes, while current apps use their own theme controls and do not consume this component. | Make theme selection controlled, with a separate next-themes adapter if retained. |
| **should-fix** | `hooks/use-fine-wheel.ts:21`, `:77` | A hook named for wheel input also owns optimistic displayed values, delayed-parent acknowledgements, and a fixed 500 ms rollback policy. | Name and document that state contract explicitly, and keep wheel-event handling as a separate concern. |
| **nice-to-have** | `hooks/use-mobile.ts:3`; `hooks/use-control-reset.ts:14` | These are reusable hooks, but their SSR breakpoint behavior and reset gestures are undocumented public contracts. | Document the initial server result and gesture behavior, and give independently exported client hooks consistent client boundaries. |

There are **no radio stores, DSP imports, or application model imports in these custom UI components**. Their coupling is mostly through embedded policy, content, and styling—not an uncontrolled dependency graph.

## 2. Drift from upstream shadcn

I fetched the current `new-york-v4` sources rather than relying solely on memory. These are observed differences from current upstream; they are not proof that every difference was an intentional customization.

Local paths below are under `packages/ui/src/components/`.

| Severity | Location | Verified difference and migration implication |
|---|---|---|
| **should-fix** | `button.tsx:7`, `:14`, `:22`, `:50` | Local Button adds `cursor-pointer` and shadows to filled variants; it lacks upstream’s extra-small/icon-size variants and emitted `data-size`/`data-variant`. **Fix:** decide which appearance and density choices are contractual before regeneration. [Upstream Button](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/button.tsx) |
| **blocker** | `dialog.tsx:56`, `:82`, `:102` | Local Dialog restores focus through a menu-trigger lookup and changes content from grid to a height-constrained flex column; upstream also has a footer-close option absent locally. **Fix:** preserve the focus behavior and scroll/layout contract through migration tests before replacing it. [Upstream Dialog](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/dialog.tsx) |
| **should-fix** | `select.tsx:42`, `:48`, `:66` | Local Select adds the application’s `xs` density and defaults positioning to `popper`, whereas current upstream defaults to `item-aligned`. **Fix:** retain the density and explicitly choose replacement positioning behavior. [Upstream Select](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/select.tsx) |
| **nice-to-have** | `input.tsx:4` | Input is materially stock: the class-token comparison found no styling differences beyond formatting/import changes. **Fix:** migrate its implementation while checking consumer sizing overrides. [Upstream Input](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/input.tsx) |
| **nice-to-have** | `tabs.tsx:7`, `:17`, `:37` | Local Tabs resembles older stock output and lacks current upstream’s orientation-aware styling and line variant. **Fix:** choose the intended API rather than treating those upstream additions as lost local work. [Upstream Tabs](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/tabs.tsx) |
| **nice-to-have** | `dropdown-menu.tsx:74` | Dropdown Menu is materially stock apart from imports, formatting, and the spelling of an important destructive-icon utility. **Fix:** preserve destructive-state appearance while accepting the new primitive’s state model. [Upstream Dropdown Menu](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/dropdown-menu.tsx) |
| **should-fix** | `field.tsx:176`, `:217` | Field’s styling matches upstream, but local conditional rewrites include `error?.message?.trim() !== ""`, which also passes for `undefined` and can render an empty error bullet. **Fix:** require a nonempty message explicitly and preserve the existing alert semantics. [Upstream Field](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/field.tsx) |

Two additional customizations matter more than most class differences:

- **blocker — `packages/ui/src/components/slider.tsx:18`, `:197`, `:242`, `:336`:** Slider contains fader shapes, default markers, origin-relative ranges, pointer snapping, reset gestures, fine-wheel input, and optimistic controlled values. **Fix:** migrate this as an interaction component with explicit behavioral acceptance tests.
- **should-fix — `packages/ui/src/components/tooltip.tsx:36`:** Tooltip suppresses opening when focus is returned programmatically after a click. **Fix:** test and deliberately reproduce the desired behavior with the replacement primitive.

Base UI’s composition mechanism uses `render`, so existing `asChild` compositions need deliberate translation, particularly the nested tooltip/popover triggers in `changelog.tsx:95`. [Base UI composition](https://base-ui.com/react/handbook/composition)

## 3. Consumption quality

The Radio app consumes the package extensively: **284 import occurrences across 38 UI subpaths** in production component files. Web has only three UI imports: the two brand icons and LegalPage.

### Rough source counts

Counts cover production `.tsx`/`.astro` in the requested directories, excluding test files. They count source occurrences, not accessibility violations or necessarily bad code.

| Pattern | Radio components | Web source |
|---|---:|---:|
| Arbitrary Tailwind bracket expressions, including selectors | 121 across 59 files | 7 across 3 files |
| Arbitrary dimensions, typography, geometry, etc. | 71 | 4 |
| Inline `style=` sites | 32 across 21 files | 0 |
| Hex-color literals | 8 across 6 files | 0 |
| Palette/black/white color utilities | 14 across 6 files | 0 |
| Radius utility occurrences | 127 | 2 |
| Shadow utility occurrences | 8 | 0 |
| Numeric z-index utility occurrences | 8 | 0 |
| Raw `<button>` elements | 17 across 14 files | 1 |

These came from `rg -n -o` searches and file inventories. Arbitrary selectors, dynamic canvas geometry, and native buttons are not inherently design-system bypasses.

### Concrete findings

| Severity | Location | Why | Fix |
|---|---|---|---|
| **should-fix** | `apps/radio/src/components/radio/node/node-toolbar.tsx:90`, `:160`, `:171` | One toolbar combines 32 px small buttons, a default 36 px icon button, and icon buttons manually overridden to 32 px. | Add supported icon/density variants and use one toolbar density consistently. |
| **should-fix** | `apps/radio/src/components/radio/node/source-strip.tsx:391`, `:613` | Consumers repeatedly turn `size="sm"` into distinct 28 px and 24 px controls using height, padding, font, and gap overrides. | Establish compact and extra-compact control variants instead of repeating their implementation. |
| **should-fix** | `apps/radio/src/components/theme/header.tsx:47` | A descendant selector forces every nested button and SVG to a particular size and color, making component appearance depend on an ancestor’s implementation knowledge. | Pass explicit density/appearance props or use a documented toolbar context. |
| **should-fix** | `packages/ui/src/components/card.tsx:21`, `:66`, `:76`; `apps/radio/src/components/audio/effect-item.tsx:93` | CardHeader contains `py-2!`, content uses `px-4`, footer uses `px-6`, and consumers override the header’s grid with several important utilities. | Define coherent Card padding/density/layout variants and remove unnecessary important declarations. |
| **should-fix** | `apps/radio/src/components/radio/dj/dj-radio-list.tsx:137`; `radio/node/station-content.tsx:166`; `radio/node/node-rack.tsx:291` under the same components directory | Session highlighting repeats `border-l-[#00d084]/40` across modes. | Introduce one session/source-accent token and consume it through shared row styling. |
| **should-fix** | `apps/radio/src/components/radio/dj/shared/peak-meter.tsx:8`; `apps/radio/src/components/radio/node/source-strip.tsx:184` | Meter zones, solo state, and warning state use unrelated hardcoded colors outside the shared semantic vocabulary. | Add app-owned signal/status tokens and reuse them consistently across CSS and component styles. |
| **should-fix** | `apps/radio/src/components/radio/node/backend-badge.tsx:21`; `apps/web/src/components/ThemeToggle.astro:8`; `apps/web/src/pages/index.astro:66` | Status tags and icon actions rebuild visual primitives independently, creating different radius, text, focus, and sizing conventions. | Extract the visual variants while keeping backend state and Astro behavior in their owning apps. |
| **should-fix** | `packages/ui/src/components/knob.tsx:253`; `apps/radio/src/components/radio/dj/deck/deck-tracklist.tsx:197`; `apps/web/src/pages/index.astro:21` | Typography includes repeated 9/10 px labels and a separate 0.95 rem marketing size without named roles. | Define caption, dense-label, body, and heading roles with explicit minimum legibility expectations. |
| **nice-to-have** | `apps/radio/src/components/theme/header.tsx:29`; `apps/radio/src/components/pwa/install-prompt.tsx:81`; `packages/ui/src/components/dialog.tsx:42` | Header, install prompt, and overlays all use `z-50` without a shared layering contract. | Document a small layer scale and test overlay ordering before centralizing it into tokens. |

Radio contains **39 `text-[10px]` and 11 `text-[9px]` occurrences** in production component sources. This is a deliberate dense interface, but that density currently exists as scattered styling rather than an explicit system.

The inline-style count is less concerning: graph positions, meter percentages, drag transforms, and runtime platform colors legitimately require dynamic values. For example, `module-frame.tsx:188` and `branch-edge.tsx:73` should not be converted into arbitrary Tailwind classes merely to reduce the count.

## 4. CSS ownership and duplication

| Severity | Location | Why | Fix |
|---|---|---|---|
| **blocker** | `packages/ui/src/styles/globals.css:3` | `../../../apps/**` resolves from this stylesheet to **`packages/apps/**`**, while the next line resolves to `packages/components/**`; both express incorrect repository assumptions. | Remove consumer-directory knowledge from package CSS and have consuming apps explicitly register their own and installed UI sources. |
| **should-fix** | `packages/ui/src/styles/globals.css:9`, `:43`, `:52` | The package already has real semantic color/radius tokens, but lacks named density, typography, status, elevation, and layering contracts while introducing literal `darkest/darker/dark` palette values. | Extend the existing semantic foundation based on actual repeated roles instead of replacing it with an unrelated token scheme. |
| **should-fix** | `packages/ui/src/styles/globals.css:128`; `apps/radio/src/components/root/root-shell.tsx:68` | The dark gradient is global package behavior and is duplicated on Radio’s application shell. | Make the gradient an app-owned surface treatment and keep the shared body background semantic. |
| **nice-to-have** | `packages/ui/src/styles/globals.css:146`, `:168` | `.container` reimplements responsive widths plus project-specific centering/padding, and `.line-clamp-2` duplicates a Tailwind utility. | Give the layout wrapper an explicit name/API and remove redundant utility definitions. |
| **should-fix** | `apps/radio/src/styles/node-mode.css:9`; `apps/radio/src/components/radio/node/control-edge.tsx:58` | Node mode defines `--node-mod`, but modulation edges use `--primary`, so the declared signal vocabulary is not consistently applied. | Use signal tokens for signal identity and keep selection/focus treatment separate. |

Tailwind documents `@source` paths as relative to the stylesheet and excludes dependencies from ordinary scanning, making source registration part of the extraction contract. [Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)

**The CSS is otherwise reasonably separated:** Web’s `global.css:1` loads fonts and imports shared styles; Node mode owns React Flow styling and signal semantics. There is no second copied shadcn token sheet in Web.

## 5. Theming

| Severity | Location | Why | Fix |
|---|---|---|---|
| **should-fix** | `packages/ui/src/styles/globals.css:12`; `apps/web/src/styles/global.css:10`; `apps/radio/src/routes/__root.tsx:8` | Shared font utilities reference Geist variables that Web defines, but Radio neither defines nor loads, leaving its intended typography dependent on fallback behavior. | Supply valid shared fallback stacks and let each app explicitly load and select fonts. |
| **should-fix** | `apps/web/src/layouts/Layout.astro:35`, `:46`; `apps/web/src/components/ThemeToggle.astro:62` | Storage access is unguarded, and resolving the initial system preference immediately persists it as an explicit light/dark choice. | Guard storage failures, preserve an unset/system preference, and react to system changes while that preference is active. |
| **should-fix** | `apps/web/src/layouts/Layout.astro:43`; `apps/web/src/components/ThemeToggle.astro:60` | Web toggles `.dark` without setting `color-scheme`, allowing native browser controls and scrollbars to disagree with the page. | Update `color-scheme` alongside the resolved theme or provide corresponding root CSS rules. |
| **nice-to-have** | `packages/ui/src/components/mode-toggle.tsx:12`; `packages/ui/src/components/sonner.tsx:10`; `packages/ui/package.json:61` | next-themes is a package-wide required peer even though only integration components use it. | Separate or make optional that integration dependency for consumers that only need primitives. |

Radio’s `root-shell.tsx:38` and `:60` use the appropriate class-based next-themes setup, hydration suppression, system default, and transition suppression. next-themes also enables native color-scheme integration by default. [next-themes documentation](https://github.com/pacocoursey/next-themes#themeprovider)

Web has a synchronous head script intended to avoid an initial theme flash, but its storage failure path undermines that protection. Theme storage is per origin; these two subdomains do not automatically share a preference.

## 6. Accessibility quick pass

| Severity | Location | Why | Fix |
|---|---|---|---|
| **should-fix** | `apps/radio/src/components/radio/dj/external-search/search-results.tsx:119`; `apps/radio/src/lib/dj-library-sources.ts:107`, `:125` | The 9 px white platform labels have calculated contrast of approximately **3.16:1 on Bandcamp’s color and 2.66:1 on SoundCloud’s**, below 4.5:1 for normal text. | Define tested foreground/background pairs for platform badges instead of always using white. |
| **should-fix** | `apps/radio/src/components/radio/node/branch-edge.tsx:83` | Cable settings use a 16 px-high button without an expanded hit target, making an already precise canvas interaction harder to operate. | Expand its interactive target while preserving the compact visual label. |
| **should-fix** | `packages/ui/src/components/slider.tsx:173`, `:361` | The wrapper gives every thumb the same label/value text and offers no per-thumb naming API, while other labeling attributes remain on the root. | Support thumb-specific accessible names and ensure labeling reaches each focusable thumb. |
| **should-fix** | `packages/ui/src/components/knob.tsx:22`, `:199` | Both possible accessible-name props are optional, allowing a valid-looking but unnamed public control. | Require one accessible naming mechanism in the type contract and test it. |
| **should-fix** | `apps/radio/src/components/radio/node/node-canvas.tsx:1207` | Programmatic viewport panning specifies a 250 ms JavaScript animation that the global CSS reduced-motion rule cannot suppress. | Resolve reduced-motion preference in the app and use immediate viewport movement when requested. |
| **nice-to-have** | `packages/ui/src/components/button.tsx:7`; `apps/web/src/components/ThemeToggle.astro:39` | Broad `transition-all` declarations make future visual-property changes animate unintentionally. | Transition only the properties each control actually needs. |

There is substantial accessibility work worth preserving:

- `knob.tsx:165` implements arrows, Home, End, disabled handling, and a visible focus ring; `:198` supplies slider values and formatted value text.
- `play-pause-button.tsx:58` creates action-specific names and preserves focus while loading through guarded `aria-disabled`.
- `volume-control.tsx:63` supplies meaningful slider labels and percentage text.
- `node-mode.css:114` replaces node outlines with a visible focus treatment.
- `globals.css:134` suppresses CSS animation, transitions, and smooth scrolling under reduced motion.
- Node signal kinds use dash patterns as well as color.

These are source-level strengths; screen-reader behavior, touch target spacing, focus visibility over actual backgrounds, and forced-colors rendering remain unverified.

## 7. Tooling and React Compiler

| Severity | Location | Why | Fix |
|---|---|---|---|
| **blocker** | `packages/ui/package.json:14`; `apps/radio/src/components/audio/control-wheel.test.tsx:3`; `apps/radio/src/components/radio/dj/shared/knob.test.tsx:3` | UI has no test script or package-local tests/stories, while important tests of its controls live in Radio and would remain behind after extraction. | Move component-level behavior tests into UI and retain application integration tests in Radio before regeneration. |
| **should-fix** | `biome.json:8`; `apps/web/package.json:15` | Astro files are excluded from Biome, and Web’s test only checks for a doctype after building. | Add an Astro-aware linting/formatting path and focused interaction checks for the theme controller. |
| **should-fix** | `packages/ui/src/components/knob.tsx:1`; `apps/radio/vite.config.ts:385`; `apps/radio/src/components/radio/node/react-compiler.test.ts:23` | UI suppressions assume compiler-stabilized handlers, but the explicit compiler regression test only covers Node-mode files and an extracted package may be compiled differently. | Document compiler expectations and verify the shared package in both compiled and ordinary React consumption. |
| **should-fix** | `apps/radio/src/components/radio/dj/shared/peak-meter.tsx:36`, `:56`, `:63`, `:86` | Meter hooks read and mutate refs during render, a concrete concern for React Compiler compatibility and render predictability. | Keep rendered meter values in a supported state/subscription model and include these components in compiler checks. |
| **nice-to-have** | `biome.json:95`; `packages/ui/components.json:3` | Class sorting is informational and the generator configuration records no upstream revision or customization inventory. | Record the regeneration baseline and local behavioral changes; use linting to enforce a few meaningful conventions rather than class-string length. |

The existing `useMemo` in `field.tsx:196` is inherited from upstream; it is not evidence that the package needs blanket memoization. There is no reason to add `useMemo`, `useCallback`, or `memo` throughout this library.

Storybook should cover the risk-bearing states first: density variants, light/dark surfaces, loading/disabled controls, menu-to-dialog focus return, nested triggers, multi-thumb labeling, and knob/slider gestures.

## 8. Extraction readiness

| Severity | Location | Why | Fix |
|---|---|---|---|
| **blocker** | `packages/ui/package.json:12` | The asset export uses glob/brace syntax that package exports do not interpret as filesystem globbing; a standard Node resolution probe failed for `@avoid.quest/ui/assets/favicon/icon0.svg`. | Use a valid mapping such as `"./assets/*": "./src/assets/*"` or explicit asset subpaths, then verify installed-package resolution. |
| **blocker** | `apps/radio/tsconfig.json:22`; `apps/web/tsconfig.json:6` | Both apps resolve every UI subpath directly into `../../packages/ui/src/*`, bypassing the published package boundary and masking export problems. | Remove those aliases and typecheck consumers against the actual package exports. |
| **blocker** | `packages/ui/package.json:44`, `:53`, `:58`; `packages/ui/tsconfig.json:2` | `catalog:` dependencies and the workspace-only config package depend on metadata outside the extracted directory. | Give the standalone repository its own dependency/version policy and portable TypeScript configuration. |
| **should-fix** | `packages/ui/package.json:3`, `:4`, `:7`, `:14` | Version `0.0.0`, `private: true`, source-only exports, and no artifact build describe an internal workspace, with no declared external distribution contract. | Decide whether consumers receive transpiled artifacts or source, then document compatible tooling, React versions, CSS integration, and release/version policy. |
| **should-fix** | `apps/web/components.json:8` | Web’s shadcn configuration directly targets the monorepo UI stylesheet. | Centralize component generation in the design-system repository and stop application generators from modifying its installed dependency. |
| **nice-to-have** | `packages/ui/src/assets/favicon/manifest.json:6`; `packages/ui/src/assets/public/_headers:2`; `packages/ui/src/assets/public/robots.txt:2` | The asset tree includes domain-specific manifest URLs, a Next.js cache rule, and a crawler policy, mixing branding with hosting behavior. | Keep brand imagery in an explicit brand entrypoint and leave manifests, headers, and robots policies with each app. |

The malformed asset mapping is a demonstrated failure, not merely a packaging preference: Node substituted the requested path into each `*` and attempted to resolve a nonexistent filename containing the brace expression. Package export patterns use string substitution. [Node package patterns](https://nodejs.org/api/packages.html#subpath-patterns)

I found no production imports written as `@avoid.quest/ui/src/...`; the broad TypeScript aliases are the principal internal reach-through.

## Validation and limits

Passed:

- `bun run check` — 925 files checked; no fixes applied.
- `bun run --filter @avoid.quest/ui typecheck`.
- `bun run --filter @avoid.quest/radio typecheck`.
- `bun run --filter @avoid.quest/radio test src/components/audio/control-wheel.test.tsx src/components/audio/control-reset.test.tsx src/components/radio/dj/shared/knob.test.tsx src/components/changelog/changelog.test.tsx` — **55 passed, 0 failed**.

Changelog tests emitted React `act(...)` warnings despite passing. The Node export-resolution probe reproduced the broken asset mapping.

I did not run builds, Web’s build-backed test, Astro’s potentially generating check, the root Turbo typecheck, or the full test suite, preserving the read-only constraint. No browser, visual-regression, assistive-technology, installed-artifact, or actual Base UI migration was verified. No files were edited, created intentionally, or committed; Git status remained clean.

## What works well

- **The custom controls have meaningful behavior tests.** They cover pointer ownership, cancellation, reset gestures, delayed parent acknowledgements, wheel precision, keyboard escape from snapping, and disabled behavior—not just snapshots.
- **Application integration mostly stays in the app.** `audio/effect-params/param-slider.tsx:41` owns DSP throttling and formatting; `radio/dj/shared/channel-slider.tsx:56` owns MIDI integration.
- **Changelog’s application data is injected correctly.** `changelog/whats-new.tsx:18` supplies generated entries, version, and storage key instead of making UI import Radio’s build machinery.
- **Semantic colors are already used widely.** The limited hardcoded-color counts do not support a claim that the whole interface needs repainting.
- **Repeated app patterns have started converging.** `radio/search-field.tsx:11`, `radio/station-row.tsx:41`, `radio/empty-hint.tsx:9`, and `radio/inline-error.tsx:4` provide useful shared composition points.
- **The package favors direct subpath imports and thin wrappers.** That is a good foundation for maintaining boundaries and migrating primitives incrementally.

## Top 10 priorities

1. **Repair package exports and remove consumer source aliases** so external consumption exercises the real API.
2. **Move UI behavior tests with the package** before replacing Radix implementations.
3. **Separate primitives, numeric controls, brand assets, and product features**, especially LegalPage and legacy post skeletons.
4. **Make CSS source registration portable** and remove application-directory assumptions.
5. **Preserve Slider, Dialog, and Tooltip behavior explicitly** during the Base UI migration.
6. **Define control-density, icon-size, typography, and status tokens** from the repeated consumer overrides.
7. **Fix contrast and compact-control accessibility**, starting with platform badges and cable buttons.
8. **Fix Radio’s font configuration** and provide valid shared fallback stacks.
9. **Unify the theme contract**, including Web’s storage handling, system preference, and native color-scheme.
10. **Establish standalone releases and verification**, including Storybook, installed-package checks, and React Compiler coverage.
