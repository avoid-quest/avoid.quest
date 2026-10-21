# Inventory: Radix surface and style drift (2026-10-19)

Produced by a read-only GPT-6-Sol delegated task. Counts are source-text occurrences from `rg`, not parsed JSX. Broad words such as `Slot`, `collapsible`, and `inverted` include unrelated domain uses.

## Scope

| Scope | Result |
|---|---:|
| `packages/ui/src/components/*.tsx` | 47 files |
| App imports of UI components | 235 import sites in 98 files |
| App-local component and layout code | 213 files, 45,043 lines; includes 56 test files |
| Radix-surface literal matches | 574 across 112 files |

## 1. Radix API surface

`U/` means `packages/ui/src/components/`; `R/` means `apps/radio/src/`.

| Token | Total | File:line examples |
|---|---:|---|
| `asChild` | 44 | `U/button.tsx:41`, `R/components/radio/radio-now-playing.tsx:103` |
| `data-[state=` | 96 | `U/context-menu.tsx:66`, `R/components/radio/node/source-strip.tsx:144` |
| `data-state` | 7 | `U/accordion.tsx:40`, `R/components/settings/mode-select.tsx:65` |
| `data-[side=` | 36 | `U/select.tsx:75` |
| `data-[align=` | 0 | — |
| `data-[orientation=` | 26 | `U/slider.tsx:293`, `R/components/radio/node/modulation-editors.tsx:114` |
| `forceMount` | 0 | — |
| `Portal` | 38 | `U/dialog.tsx:10` |
| `onValueChange` | 53 | `U/slider.tsx:164`, `R/components/settings/audio-settings.tsx:200` |
| `onCheckedChange` | 15 | `R/components/settings/sync-dialog.tsx:45` |
| `onOpenChange` | 29 | `U/changelog.tsx:91`, `R/components/settings/radio-dialog.tsx:24` |
| `onValueCommit` | 10 | `U/slider.tsx:165` |
| `onPressedChange` | 11 | `R/components/radio/node/source-strip.tsx:172` |
| `onSelect=` | 14 | `R/components/radio/node/node-toolbar.tsx:119` |
| `Slot` | 88 | `U/button.tsx:2`; many unrelated audio "slot" identifiers |
| `SelectValue` with same-line `placeholder` | 8 | `R/components/settings/audio-settings.tsx:204` |
| `SelectItem value=""` | 0 | — |
| `TooltipProvider` | 4 | `U/tooltip.tsx:15` |
| `delayDuration` | 3 | `U/tooltip.tsx:16` |
| `DialogOverlay` | 3 | `U/dialog.tsx:35` |
| `PopoverAnchor` | 2 | `U/popover.tsx:43` |
| `sideOffset` | 16 | `U/tooltip.tsx:55`, `R/components/settings/settings-button.tsx:66` |
| `collisionPadding`, `modal=`, `onPointerDownOutside`, `onInteractOutside` | 0 each | — |
| `onOpenAutoFocus`, `onCloseAutoFocus` | 3 each | `U/dialog.tsx:76–77` |
| `onEscapeKeyDown` | 1 | `R/components/settings/settings-button.tsx:71` |
| `--radix-` | 13 | `U/select.tsx:75` |
| `type="single"`, `type="multiple"` | 2, 3 | `R/components/settings/mode-select.tsx:57`, `R/components/radio/dj/deck/deck-loaded-content.tsx:70` |
| `collapsible` | 36 | `U/collapsible.tsx:8`; includes ordinary domain text |
| `minStepsBetweenThumbs` | 7 | `U/slider.tsx:162` |
| `inverted` | 3 | domain text only |

| Dependency import | Sites | Every importing file |
|---|---:|---|
| `vaul` | 1 | `U/drawer.tsx:5` |
| `embla-carousel-react` | 1 | `U/carousel.tsx:7` |
| `react-resizable-panels` | 2 | `U/resizable.tsx:10,57` |
| `cmdk` | 0 | — |
| `@radix-ui/*` | 24 | select, dropdown-menu, collapsible, checkbox, toggle, button, separator, badge, dialog, avatar, toggle-group, item, radio-group, switch, tooltip, accordion, label, scroll-area, hover-card, progress, popover, slider, tabs, aspect-ratio |
| `radix-ui` | 1 | `U/context-menu.tsx:5` |

Per UI file (literal occurrences): context-menu (state 14, side 8, Portal 6, radix var 3); select (asChild 1, state 6, side 8, Portal 3, radix var 4); dropdown-menu (state 14, side 8, Portal 7, sideOffset 3, radix var 3); dialog (state 12, Portal 7, DialogOverlay 3, onOpenAutoFocus 3, onCloseAutoFocus 3); switch (state 7); tooltip (state 3, side 4, Portal 3, TooltipProvider 4, delayDuration 3, sideOffset 3); hover-card and popover (state 6, side 4, Portal 3, sideOffset 3); slider (orientation 20, onValueChange 3, onValueCommit 5, minStepsBetweenThumbs 5); tabs (state 5); drawer (state 4, Portal 6); checkbox (state 4); button, badge, item (asChild 3, Slot 2 each); legal-page (asChild 5); changelog (asChild 2, onOpenChange 2, sideOffset 1).

Radio app files with the most Radix-specific props: `feedback/app-feedback.tsx`, `settings/settings-form.tsx`, `settings/settings-button.tsx`, `settings/sync-dialog.tsx`, `settings/audio-settings.tsx`, `radio/radio-now-playing.tsx`, `radio/node/source-strip.tsx`, `radio/node/node-toolbar.tsx`, `radio/node/node-rack.tsx`, `radio/node/module-frame.tsx`, `radio/dj/deck/deck-transport.tsx`, `radio/dj/deck/deck-loaded-content.tsx`, `audio/midi-transform-editor.tsx`, `audio/effect-params/container-params.tsx`.

## 2. UI component import blast radius

All 235 sites are in radio except `avoid-logo`, `github-icon`, and `legal-page`, which also occur in web.

| Component | Sites |
|---|---:|
| button | 54 |
| select | 14 |
| input | 13 |
| slider | 12 |
| dialog, label, scroll-area, switch | 11 each |
| spinner | 10 |
| knob | 8 |
| dropdown-menu | 7 |
| field | 6 |
| skeleton, tabs | 5 each |
| badge, drawer, play-pause-button, textarea, toggle, tooltip | 4 each |
| accordion, alert, card, popover | 3 each |
| avoid-logo, changelog, checkbox, collapsible, github-icon, legal-page, radio-group, toggle-group | 2 each |
| context-menu, empty, resizable, separator, sonner | 1 each |
| aspect-ratio, avatar, carousel, hover-card, item, mode-toggle, progress, site-logo, skeletons, user-avatar | 0 |

## 3. App-local files

App-local components are overwhelmingly domain features (node graph, DJ decks, mixer, effect params, settings). Files flagged as generic-primitive wrappers: `audio/midi-badge.tsx`, `audio/effect-params/param-select.tsx`, `param-slider.tsx`, `param-switch.tsx`, `theme/header.tsx`, `radio/confirm-delete-dialog.tsx`, `radio/genre-badges.tsx`, `radio/search-field.tsx`, `radio/dj/external-search/search-input.tsx`, `radio/dj/shared/channel-slider.tsx`, `radio/node/backend-badge.tsx`, `settings/settings-button.tsx`. Web has only `components/ThemeToggle.astro` and `layouts/Layout.astro`. No app-wide replacement primitive library exists.

Largest files: `radio/node/node-canvas.tsx` 1279, `radio/node/module-frame.tsx` 651, `radio/node/source-strip.tsx` 641, `audio/effect-params/container-params.tsx` 631, `radio/dj/deck/deck-panel.tsx` 597, `radio/node/flow-elements.ts` 583.

Tests importing UI components directly (all under `apps/radio/src/components/`): `audio/control-reset.test.tsx`, `audio/control-wheel.test.tsx` (knob, slider), `changelog/changelog.test.tsx`, `radio/dj/external-search/search-results.test.tsx` (scroll-area), `radio/dj/shared/knob.test.tsx`. No test file exists in `packages/ui`.

## 4. Style literals and utility histograms

| Family | Occurrences | Top values or examples |
|---|---:|---|
| Arbitrary px/rem sizes | 102 in 60 files | `U/context-menu.tsx:86` `min-w-[8rem]`; `U/input.tsx:9` `ring-[3px]` |
| Arbitrary literal colors in classes | 0 | — |
| Arbitrary `z-[…]`, `shadow-[…]` | 0 | — |
| Arbitrary selectors (legit) | 205 in 47 files | `[&_svg]`, `data-[size=xs]` |
| Inline `style={{` | 26 in 21 files | `U/progress.tsx:24`; `R/components/audio/effect-item.tsx:103` |
| `z-<number>` | 25 in 18 files | `z-50` in dialog, header, install prompt |
| Rounded | 183 | md 62; sm 43; full 29; lg 27; xl 4; 2xl 3; other 15 |
| Text size | 358 | xs 196; sm 86; `[10px]` 41; `[9px]` 12; lg 7; base 5; `[0.95rem]` 4; 3xl 3; 2xl 2; xl 1; `[11px]` 1 |
| `h-{6..12}` on controls | 107 | h-7 47; h-8 36; h-9 8; h-6 7; h-10 6; h-12 3 |
| Gap/padding/space | 807 | gap-2 122; gap-1 54; gap-3 48; px-2 47; gap-1.5 44; space-y-2 30; py-1.5 27; px-3 26; py-2 26 |
| Shadow | 33 | xs 12; lg 7; md 5; none 4; sm 4; xl 1 |
| Font weight | 95 | medium 71; semibold 15; bold 9 |
| Duration/transition | 79 | transition 17; transition-colors 15; transition-all 10 |
| `size-{3..6}` icons | 164 | size-3 92; size-4 52; size-6 15; size-5 5 |

| Non-semantic color family | Occurrences | Files |
|---|---:|---|
| `bg-zinc-*`, `text-neutral-*`, `*-green-*`, `border-white/*` | 0 | — |
| `bg-white` | 2 | `U/slider.tsx:365` |
| `text-black` | 1 | `U/avoid-logo.tsx:7` |
| `*-red-*` | 1 | `R/components/radio/dj/shared/peak-meter.tsx:149` |
| `*-emerald-*` | 2 | `R/components/settings/midi-settings.tsx:356` |
| `*-amber-*` | 10 | `R/components/radio/node/source-strip.tsx:184–185`, `control-node.tsx:118`, `audio-input-controls.tsx:56,239` |
| `bg-black/*` | 4 | `U/dialog.tsx:42`, `U/drawer.tsx:48` |

Hex literals live mostly in `apps/radio/src/styles/node-mode.css` (six declarations) and in a few TSX files (`border-l-[#00d084]/40` session accent, platform brand colors in `lib/dj-library-sources.ts`, peak-meter zones).

## 5–7. CSS, theme, fonts

| File | Custom properties | Notes |
|---|---:|---|
| `packages/ui/src/styles/globals.css` | 72 unique; 103 definitions | Semantic colors and radii; `--font-sans`/`--font-mono` reference Geist variables; literal `oklch()` palette; `.dark body` gradient; `.container`, `.line-clamp-2`, `.no-scrollbar` utilities |
| `apps/radio/src/styles/node-mode.css` | 16 unique | 5 `--node-*` signal tokens and 11 `--xy-*` React Flow tokens; six hardcoded hex colors at lines 11–13, 18–20; no `@theme` |
| `apps/web/src/styles/global.css` | 2 | Defines `--font-geist-sans` and `--font-geist-mono`; imports Geist via @fontsource |

| Check | Result |
|---|---|
| Shared CSS `@source "../../../apps/**/*.{ts,tsx}"` | Resolves to `<repo>/packages/apps/**`, which does not exist. The sibling `../../../components/**` resolves to `<repo>/packages/components/**`, which also does not exist. |
| Radio theme | `root-shell.tsx:60`: next-themes with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`. No explicit `color-scheme` rule. Static `theme-color` `#000000` at `routes/__root.tsx:93`. |
| Web theme | No next-themes; `layouts/Layout.astro:33–47` inline script reads/stores `theme`, checks `prefers-color-scheme`, adds `.dark` before body. No `theme-color` meta or `color-scheme` rule. |
| Radio Geist | No Geist import and no definition of `--font-geist-sans` / `--font-geist-mono` anywhere in radio. Shared CSS references both, so radio falls back to the browser default sans. |

## 8–10. Tooling, icons, export probe

| Item | Inventory |
|---|---|
| Biome UI rules | `nursery.useSortedClasses: "info"`; a11y rules inherited from ultracite presets; `*.astro` excluded from linting. |
| Config package | `base.json`: strict NodeNext ES2022, declarations, `noUncheckedIndexedAccess`; `react-library.json`: React JSX. |
| UI tsconfig | Extends `@avoid.quest/config/react-library.json`; maps `@avoid.quest/ui/*` to `./src/*`. |
| App UI aliases | `apps/radio/tsconfig.json:22` and `apps/web/tsconfig.json:6` both map `@avoid.quest/ui/*` to `../../packages/ui/src/*`, bypassing the package `exports` map. |
| `lucide-react` imports | Radio 58 files; web 0; UI package 15 files. Inline SVG in `control-node.tsx:95`, `modulation-editors.tsx:167`, `ThemeToggle.astro:10`, `avoid-logo.tsx`, `knob.tsx:217`, `github-icon.tsx`. |
| UI asset export probe | From `apps/radio`, `import.meta.resolve('@avoid.quest/ui/assets/favicon/icon0.svg')` returns a malformed URL ending in `.%7Bpng,jpg,jpeg,svg,webmanifest,ico,json,txt%7D`; dynamic import fails with `ERR_MODULE_NOT_FOUND`. Cause: the `"./assets/*": "./src/assets/**/*.{png,...}"` target in `packages/ui/package.json` uses glob syntax that Node `exports` does not support. |
