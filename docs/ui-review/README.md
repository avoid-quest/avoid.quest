# UI review and design-system plan (2026-10-19)

State of the UI layer before introducing a real design system, and the mechanical plan for the four follow-up projects: Radix to Base UI, design tokens, Storybook, and extracting `packages/ui` into its own repository.

Source reports in this folder:

| File | Produced by | What it is |
|---|---|---|
| `2026-10-19-code-quality-review.md` | GPT-6.1-Sol, read-only code review | Architecture, shadcn drift, consumption quality, CSS, theming, accessibility, tooling, extraction readiness |
| `2026-10-19-inventory-radix-surface-and-style-drift.md` | GPT-6-Sol, `rg` inventory | Counts: Radix API surface, import blast radius, style histograms, theme and font plumbing, export probe |
| `2026-10-19-live-audit.md` and `-measurements.md` | GPT-6.1-Sol driving both dev apps in a browser | Per-route findings at 1440×900 and 390×844, light and dark, with 83 screenshots (14 kept in `images/`) |
| `2026-10-19-research-base-ui-tokens-storybook-extraction.md` | GPT-6-Astra, web research against primary sources | Base UI via shadcn, API mapping tables, token tooling, Storybook 10 setup, repo-extraction options |
| `2026-11-01-radio-structure-proposal.md` | Claude Opus 5.5, code inventory via subagents | Radio app screen inventory, task map per mode, and proposed naming, grouping, navigation and implementation slices (NWS-2788). Its line refs were checked by the writer and a separate review agent, not by the cross-check described below |

Everything below was cross-checked against the repository by the orchestrating agent (Claude Fable 5.1); claims that could not be verified are marked as such.

## 1. Verdict

The component package is a healthy shadcn collection with a few genuinely good custom controls, but it is **not yet a design system** and **not yet publishable**. Three categories of problems:

1. **Packaging defects that only stay hidden because both apps alias straight into the package source.** The `exports` map for assets is broken, the shared stylesheet scans directories that do not exist, and `catalog:` / `workspace:` dependencies tie the package to this monorepo.
2. **Design decisions that live as scattered classes instead of tokens.** A compact 28px/32px control density, a 9px/10px caption scale, status and signal colours, a z-index ladder, and a dark-mode gradient all exist, but none is named.
3. **Product-level UI defects** unrelated to the primitive library: Node mode on mobile clips its only node off-screen and lets keyboard focus leave the viewport, many targets are well below 44px, the radio app never loads Geist, and secondary actions are hover-only.

What works: semantic colour tokens are used almost everywhere (zero `bg-zinc-*`, two `bg-white`), light/dark inversion is coherent, the custom Knob and Slider have real behaviour tests, modal focus trapping and restoration work, every visible control had an accessible name in the live audit, and app integration (DSP throttling, MIDI) stays in the app rather than leaking into the package.

## 2. What is broken (verified)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | Blocker for extraction | `packages/ui/package.json` exports `"./assets/*": "./src/assets/**/*.{png,...}"`. Node `exports` does not support globs; `import.meta.resolve("@avoid.quest/ui/assets/favicon/icon0.svg")` yields a malformed URL and `ERR_MODULE_NOT_FOUND`. | inventory §10 |
| 2 | Blocker for extraction | `packages/ui/src/styles/globals.css:3-4` has `@source "../../../apps/**"` and `"../../../components/**"`, which resolve to `packages/apps` and `packages/components`. Neither exists. The apps are only styled today because each app's own Vite root is scanned automatically. | verified by `pwd` resolution |
| 3 | Blocker for extraction | `apps/radio/tsconfig.json:22` and `apps/web/tsconfig.json:6` map `@avoid.quest/ui/*` to `../../packages/ui/src/*`, so TypeScript never exercises the package `exports` map. | inventory §8 |
| 4 | Blocker for extraction | `catalog:` deps, `workspace:*` on `@avoid.quest/config`, `tsconfig` extending the config package, `private: true`, `version 0.0.0`, no build. | code review §8 |
| 5 | Should fix | Radio never loads Geist. Shared CSS sets `--font-sans: var(--font-geist-sans)`; only `apps/web/src/styles/global.css` defines it. Live audit: radio body computes to the system font stack, `document.fonts` is empty. | live audit finding 3 |
| 6 | Should fix | Dark gradient is both global package behaviour (`globals.css .dark body`) and duplicated in `apps/radio/src/components/root/root-shell.tsx:68`. | code review §4 |
| 7 | Should fix | Web theme: storage access unguarded, resolving system preference persists it as an explicit choice, `color-scheme` never set (live audit confirmed `color-scheme: normal` in dark). Radio does set it via next-themes. | code review §5, live audit |
| 8 | Should fix | `packages/ui` has no tests and no stories. The five test files that exercise Knob, Slider, Changelog and ScrollArea live in `apps/radio`. | inventory §8 |
| 9 | Should fix | Product content in the shared package: `legal-page.tsx` hardcodes repo, openDAW licensing text and `/legal/*` routes; `skeletons.tsx` encodes a post-card layout no app uses; `site-logo`, `user-avatar`, `mode-toggle`, `item`, `hover-card`, `avatar`, `progress`, `aspect-ratio`, `carousel` have zero consumers. | inventory §2 |
| 10 | Should fix | `user-avatar.tsx` ignores `fallback` when `username` is absent; `field.tsx` error check `error?.message?.trim() !== ""` passes for `undefined` and can render an empty error bullet. | code review §1-2 |
| 11 | Should fix | `/api/feedback` returns 502 `issue_create_failed` in local dev (token absent). Legal routes 404 locally because `scripts/prepare-legal.ts` only runs in `build`, not `dev`. | live audit findings 5, feedback section |
| 12 | Should fix | `root-error-view.tsx` nests `<Button>` inside `<Link>`, producing two tab stops for one action. | live audit finding 6 |

### Live-app UX defects (independent of the primitive migration)

| Severity | Finding | Screenshot |
|---|---|---|
| High | Node canvas not fitted on mobile: Track node starts at x≈211 with width 336 in a 390px viewport, Speakers at x≈667 fully off-screen; Tab reaches off-screen cable and Remove buttons with no visible focus and no auto-pan. | `images/radio-node-cold-mobile-dark.png`, `images/radio-node-mobile-dark-focus-10.png` |
| High | Dense controls under 44px everywhere: 28px header buttons and mode switches, 32px inputs, 14px reorder handles, 16px checkboxes and volume thumbs, 20×36 crossfader, 28px link rows on web. 40 small targets on Single mobile, 79 on Settings. | `images/radio-settings-mobile-light.png` |
| Medium | Station-row Details/Options are `opacity: 0` at rest (hover-only); Feedback and What's new disappear from the mobile header with no alternative entry point. | `images/radio-single-mobile-light.png` |
| Medium | Add-station modal stacks over the settings drawer: two overlay patterns, two close affordances. | `images/radio-add-station-mobile-dark.png` |
| Medium | What's new popover opened on desktop then resized to mobile stays detached top-left. | live audit |
| Medium | Platform badges: 9px white text on Bandcamp (≈3.2:1) and SoundCloud (≈2.7:1) brand colours. | code review §6 |
| Low | Web home has no h1, destination links read as plain text until hover, links open new tabs with no indicator. | `images/web-home-desktop-light.png` |

### Measured consistency (live, computed styles, light theme, desktop / mobile)

| Surface | Unique font sizes | Unique radii | Unique colours | Unique backgrounds | DOM elements |
|---|---:|---:|---:|---:|---:|
| radio Single | 6 / 6 | 8 / 8 | 8 / 8 | 9 / 9 | 406 |
| radio Node | 4 / 4 | 8 / 8 | 9 / 9 | 11 / 10 | 226 / 189 |
| radio DJ | 5 / 5 | 7 / 7 | 7 / 7 | 10 / 10 | 574 / 278 |
| radio Settings | 6 / 6 | 10 / 11 | 7 / 7 | 11 / 11 | 729 |
| radio Node + Add | 5 / 4 | 10 / 11 | 14 / 13 | 18 / 17 | 862 / 823 |
| web Home | 3 / 3 | 2 / 2 | 5 / 5 | 2 / 2 | 65 |

These numbers are not chaotic. The palette is coherent; the problem is that the radius and type scales are implicit. Source histograms show it: `text-xs` 196, `text-sm` 86, `text-[10px]` 41, `text-[9px]` 12; `h-7` 47, `h-8` 36, `h-9` 8; `rounded-md` 62, `rounded-sm` 43, `rounded-full` 29, `rounded-lg` 27.

## 3. Migration surface (what Base UI will touch)

From the inventory, all counts are source occurrences across `packages/ui` and `apps/*`:

| Radix construct | Count | Base UI replacement |
|---|---:|---|
| `asChild` | 44 (24 in apps) | `render={<Comp />}` prop; `useRender` for Button/Badge/Item polymorphism |
| `data-[state=…]` selectors | 96 | `data-open`, `data-closed`, `data-checked`, `data-active`, `data-pressed`, `data-selected` |
| `data-[side=…]` / `--radix-*` vars | 36 / 13 | `data-side` stays; `--transform-origin`, `--available-height`, `--anchor-width` |
| `onValueChange` | 53 | same name, signature `(value, eventDetails)`; Select single value can be `null` |
| `onOpenChange` | 29 | same name, `(open, eventDetails)` |
| `onCheckedChange` | 15 | same name, `(checked, eventDetails)` |
| `onPressedChange` | 11 | same name on Toggle; ToggleGroup uses `multiple` boolean and array values |
| `onValueCommit` | 10 | `onValueCommitted` |
| `onOpenAutoFocus` / `onCloseAutoFocus` | 3 / 3 (dialog.tsx only) | `initialFocus` / `finalFocus`; custom menu-trigger return-focus logic must be ported by hand |
| `TooltipProvider delayDuration` | 4 / 3 | `Tooltip.Provider delay`, `closeDelay`, `timeout` |
| `type="single"` on Accordion/ToggleGroup | 5 | array values + `multiple` |
| `minStepsBetweenThumbs` | 7 (slider.tsx) | `minStepsBetweenValues`; `Slider.Control > Track > Indicator`; per-thumb `index` |
| `vaul` Drawer | 1 file, 4 app imports | keep Vaul initially; Base UI Drawer (stable since 1.3) evaluated separately |

Import blast radius by component (app import sites): button 54, select 14, input 13, slider 12, dialog / label / scroll-area / switch 11 each, spinner 10, knob 8, dropdown-menu 7, field 6, tabs / skeleton 5, badge / drawer / toggle / tooltip / textarea / play-pause-button 4, then a long tail of 1 to 3.

Components needing deliberate behaviour preservation, not regeneration: `slider.tsx` (fader variants, markers, origin-relative ranges, snap, reset gesture, fine wheel, optimistic values), `dialog.tsx` (return focus to menu trigger, flex column + `max-h-[90vh]`), `tooltip.tsx` (suppress open on programmatic focus), `select.tsx` (`xs` density, `popper` positioning default), `knob.tsx` (already Radix-free).

## 4. Recommended order of work

Do not start with the Base UI swap. The swap is the riskiest step and currently has no safety net.

1. **Fix packaging and make the package honest** (small PR, no visual change).
   - `exports`: `"./assets/*": "./src/assets/*"`; remove the glob.
   - Remove the two bad `@source` lines from `globals.css`; add `@source "../"` for the package itself. Each app adds its own `@source` lines in its own CSS entry.
   - Delete the `@avoid.quest/ui/*` path aliases from both app tsconfigs and typecheck against the real exports map. Expect a few import fixes.
   - Load Geist in radio (`@fontsource/geist-sans`, `@fontsource/geist-mono`, define the two variables) or make the package's `--font-sans` carry a real fallback stack.
   - Move the `.dark body` gradient out of the package into radio.
   - Move `legal-page.tsx` content into the apps; delete `skeletons.tsx`; decide on `site-logo`, `mode-toggle`, `user-avatar`.
   - Move the five component tests from `apps/radio` into `packages/ui` (add `bun test` script there).
2. **Storybook in `packages/ui`** so every later step has a visual and interaction baseline. Stories for button sizes/variants, dialog from menu (focus return), select xs, slider faders, knob, drawer, tabs, tooltip, light/dark, disabled/focus-visible states. Add the Vitest browser-mode project so `play` functions run in CI.
3. **Tokens, layered onto what exists.** Keep every shadcn semantic name. Add the missing roles the inventory exposed, then replace the scattered classes with them.
4. **Base UI migration**, component by component, in blast-radius order, behind parallel files and the Storybook baseline.
5. **Extraction** to its own repository only after 1 to 4, because each of them changes what gets published.

## 5. Mechanical recipes

### 5.1 Tokens (Tailwind v4 as the token source)

Superseded by [NWS-2784](https://linear.app/nws2/issue/NWS-2784): standard Tailwind
sizes and semantic state colours replace the three-tier proposal below. The selected
theme and font source is shadcn preset `beXRToEi`; see the current
[UI theme documentation](../../packages/ui/README.md#theme).

Three tiers, all CSS variables, all in `packages/ui/src/styles/`. Split `globals.css` into `theme.css` (tokens) and `globals.css` (imports + base layer) so consumers can import tokens without Preflight if needed.

```css
/* theme.css */
:root {
  /* tier 1: reference */
  --aq-ref-neutral-50: oklch(0.985 0 0);
  --aq-ref-neutral-950: oklch(0.145 0 0);
  --aq-ref-radius-2: 0.625rem;
  --aq-ref-duration-fast: 120ms;

  /* tier 2: semantic (shadcn names kept verbatim) */
  --background: var(--aq-ref-neutral-50);
  --foreground: var(--aq-ref-neutral-950);
  --radius: var(--aq-ref-radius-2);

  /* tier 2: roles the inventory showed are missing */
  --aq-sys-control-xs: 1.5rem;   /* 24px: today's h-6 overrides */
  --aq-sys-control-sm: 1.75rem;  /* 28px: today's h-7 (47 uses) */
  --aq-sys-control-md: 2rem;     /* 32px: today's h-8 (36 uses) */
  --aq-sys-control-lg: 2.25rem;  /* 36px: shadcn default h-9 */
  --aq-sys-touch-min: 2.75rem;   /* 44px */
  --aq-sys-layer-header: 30;
  --aq-sys-layer-overlay: 50;
  --aq-sys-layer-toast: 60;
  --aq-sys-status-warning: oklch(0.8 0.17 80);     /* replaces amber-* (10 uses) */
  --aq-sys-status-success: oklch(0.72 0.17 160);   /* replaces emerald-* */
  --aq-sys-signal-session: #00d084;                 /* replaces border-l-[#00d084] */
}
.dark { /* semantic overrides only */ }

@theme inline {
  --color-background: var(--background);
  /* ...existing shadcn mappings unchanged... */
  --color-status-warning: var(--aq-sys-status-warning);
  --color-status-success: var(--aq-sys-status-success);
  --color-signal-session: var(--aq-sys-signal-session);
  --spacing-control-xs: var(--aq-sys-control-xs);
  --spacing-control-sm: var(--aq-sys-control-sm);
  --spacing-control-md: var(--aq-sys-control-md);
  --spacing-control-lg: var(--aq-sys-control-lg);
  --spacing-touch: var(--aq-sys-touch-min);
  --text-caption: 0.625rem;            /* 10px, 41 uses today */
  --text-caption--line-height: 0.875rem;
  --text-micro: 0.5625rem;             /* 9px, 12 uses today; audit before keeping */
  --font-sans: var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif);
  --font-mono: var(--font-geist-mono, ui-monospace, monospace);
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

Usage becomes `h-control-sm`, `text-caption`, `bg-status-warning`, `z-(--aq-sys-layer-overlay)`. Z-index and duration have no automatic Tailwind namespace; use the `z-(--var)` form or an `@utility`.

Then encode density in the components instead of at call sites: add `xs` and `sm` icon sizes to `buttonVariants`, a `density` prop on Card, and delete the `h-7`/`h-6` overrides in `node-toolbar.tsx`, `source-strip.tsx`, `header.tsx`.

Enforcement: a small Bun script run from `bun run check` that parses TSX with the TypeScript compiler API, visits `className`, `cn(...)`, `cva(...)` string literals, and fails on `#hex`, `rgb(`, `oklch(` and on arbitrary design values matching `^(p|m|gap|h|w|text|rounded|z|shadow)-\[` while allowing selector brackets (`[&`, `data-[`, `aria-[`) and a reviewed allowlist. Do not ban `[...]` wholesale; shadcn relies on selector brackets.

Skip Style Dictionary and Terrazzo for now. They pay off only when a design tool or a non-web platform needs the same tokens. The DTCG format is a community-group spec, not a W3C Recommendation.

### 5.2 Storybook 10 in `packages/ui`

```bash
cd packages/ui
bunx create-storybook@10 --type react --builder vite --package-manager bun --features docs test a11y
bun add -d @storybook/addon-themes@10 vitest@5 @vitest/browser-playwright@5 playwright
bunx playwright install chromium webkit
```

`.storybook/main.ts` uses `@storybook/react-vite` with `@tailwindcss/vite` added in `viteFinal`; do not reuse radio's Vite config. `.storybook/preview.tsx` imports `../src/styles/globals.css`, applies `withThemeByClassName({ light: "", dark: "dark" })` and wraps in a next-themes `ThemeProvider` with `forcedTheme` so the Sonner wrapper's `useTheme()` agrees. Enable `a11y: { test: "error" }`. Use CSF 3; CSF Next is still preview. Add `storybook`, `build-storybook`, `test:stories` scripts and Turbo tasks (`build-storybook` cached with `storybook-static/**` output). Visual regression: start self-hosted with Vitest browser `toMatchScreenshot` on a dozen stories; evaluate Chromatic (free tier 5,000 snapshots/month) only if review workflow becomes the bottleneck.

Known caveat: Storybook and Vitest run on Node, installed with Bun. Do not force `bunx --bun` for them.

### 5.3 Radix to Base UI via shadcn

Facts verified against shadcn CLI 4.22 and Base UI 1.9 (both October 2026):

- Base UI is selected by `components.json` `"style": "base-nova"` (or `shadcn init --base base --preset nova`). There is no `base-new-york`. Switching style changes future `add` output only; it does not rewrite installed files.
- Of the 38 components in use, 37 exist in the `base-nova` registry; `knob` is yours. Registry `drawer` is now Base UI Drawer, not Vaul. `sonner`, `resizable`, `carousel` keep their third-party engines.
- There is an official shadcn skill (`skills/migrate-radix-to-base`) with class-mapping and consumer-prop tables, but no AST codemod. `shadcn migrate radix` only consolidates to the `radix-ui` package; it does not move to Base UI.

Recipe:

```bash
git switch -c chore/ui-base-migration
bun run check && bun run typecheck && bun run --filter @avoid.quest/radio test
bun add --cwd packages/ui @base-ui/react@^1.9.0
# disposable reference workspace to see what the generator emits today
mkdir -p /tmp/ui-base && cd /tmp/ui-base && bunx --bun shadcn@latest init --base base --preset nova && bunx --bun shadcn@latest add button dialog select slider tabs tooltip dropdown-menu popover switch checkbox toggle toggle-group accordion collapsible scroll-area
```

Then, per component, in this order (lowest risk and highest reuse first):

1. `button`, `badge`, `item`: replace `Slot`/`asChild` with `useRender`; keep `buttonVariants` and the local `cursor-pointer`/shadow choices; add `xs` and `icon-sm` sizes while here. Update the 24 app `asChild` sites to `render`.
2. `label`, `separator`, `switch`, `checkbox`, `toggle`, `toggle-group`, `radio-group`: callback signatures gain `eventDetails`; ToggleGroup `type` becomes `multiple`; `data-[state=checked]` becomes `data-checked`.
3. `tabs`, `collapsible`, `accordion`: `Trigger`/`Content` become `Tab`/`Panel`; add `activateOnFocus` on `Tabs.List` to keep Radix's automatic activation; Accordion value becomes an array.
4. `tooltip`, `popover`, `hover-card`: `Portal > Positioner > Popup`; port the "no open on programmatic focus" guard.
5. `dropdown-menu`, `context-menu`, `select`: `Menu`/`ContextMenu`/`Select` with `Positioner`; Select `popper` becomes `alignItemWithTrigger={false}`; handle `null` from single-select `onValueChange`; keep the `xs` size; verify `closeOnClick` for checkbox items.
6. `dialog`: `Overlay` becomes `Backdrop`, `Content` becomes `Popup`; port `getReturnFocusTarget` into `finalFocus`; keep flex column and `max-h`. Write the Storybook play test "open dialog from dropdown item, close, focus lands on menu trigger" before touching it.
7. `slider`: the largest rewrite. `Control > Track > Indicator`, `onValueCommitted`, `minStepsBetweenValues`, per-thumb `index`. The `control-wheel`, `control-reset` and `knob` tests move with it and must stay green.
8. `scroll-area`, `progress`, `avatar`, `aspect-ratio`: trivial or CSS-only.
9. Leave `drawer` on Vaul; open a separate ticket to evaluate Base UI Drawer in the settings drawer with slider gestures inside it.

Work in parallel files (`button-base.tsx`) only while a component's app consumers are split; never mix Radix and Base parts inside one compound. After each family: `bun run typecheck`, `bun run --filter @avoid.quest/radio test`, Storybook play tests. Remove `@radix-ui/*` deps only when `rg "@radix-ui|from \"radix-ui\"" packages apps` is empty; Vaul keeps a transitive Radix dialog.

Global search-and-replace that is safe to run once per component file: `data-[state=open]` → `data-open`, `data-[state=closed]` → `data-closed`, `data-[state=checked]` → `data-checked`, `data-[state=active]` → `data-active`, `data-[state=on]` → `data-pressed`, `--radix-*-content-transform-origin` → `--transform-origin`, `--radix-*-available-height` → `--available-height`, `--radix-*-trigger-width` → `--anchor-width`. `tw-animate-css` stays; current shadcn Base templates use `data-open:animate-in`.

Base UI rough edges to test for an audio app on 1.9: VoiceOver slider value announcement (open issue), WebKit focus guards in dialogs, SSR radio-group labelling, slider touch inside drawers. For Astro, keep provider, trigger and popup in one React island.

### 5.4 Extraction to its own repository

Recommendation: a versioned npm package (private scope on npm or GitHub Packages), built with tsdown, released with Changesets. Not a shadcn registry (copies drift across repos), not a submodule.

Steps once sections 1 to 4 are done:

1. New repo `<org>/ui` with the contents of `packages/ui`, plus its own `tsconfig.json` (inline what `@avoid.quest/config/react-library.json` provides), its own Biome config, Storybook, and tests. Replace every `catalog:` with a concrete range.
2. Build with tsdown: entry `src/components/*.tsx`, `src/hooks/*.ts`, `src/lib/*.ts`; `unbundle: true`, `dts: true`, ESM only, React and all `dependencies`/`peerDependencies` external; copy `src/styles` and `src/assets` into `dist`. Confirm `"use client"` directives survive and inspect `bun pm pack` output.
3. `package.json`: `"files": ["dist"]`, `"sideEffects": ["**/*.css"]`, `exports` with `types` + `import` for `./components/*`, `./hooks/*`, `./lib/*`, plus `./globals.css`, `./theme.css`, `./assets/*`; `peerDependencies` react ^19.3, react-dom ^19.3, tailwindcss ^4.3, next-themes optional; `publishConfig.access: "restricted"`.
4. CSS contract: consumers compile Tailwind. The published `globals.css` registers its own sources (`@source "../components";`) so a consumer only writes `@import "@org/ui/globals.css";` plus its own `@source`. Document that `node_modules` is not scanned by default.
5. Changesets 3 + `changesets/action@v2` with `version-script` / `publish-script`, Node 24 and Bun 1.4 in CI. `NPM_TOKEN` or `GITHUB_TOKEN` with `packages: write` is a credential to provision, not something in this repo.
6. In this monorepo, replace `packages/ui` with the dependency, remove the tsconfig aliases for good, and validate with `bun run build` on both apps from a packed tarball before the first tagged release. Astro SSR and TanStack Start SSR both need to pass against `dist`, not source.

## 6. Open decisions for the owner

- **Visual style under Base UI**: keep `new-york` visuals (recommended, zero redesign) or adopt `base-nova` look for all future `shadcn add` output. These are separate decisions; mixing them per component is what to avoid.
- **9px type**: keep as a named `text-micro` role for the DJ mixer only, or raise everything to 10px. The audit flagged contrast failures on 9px white-on-brand badges either way.
- **Touch targets**: the radio app is a dense desktop tool with a mobile layout. Decide whether mobile gets a separate density (token swap under a media query) or the compact scale is accepted with 44px hit areas via padding.
- **Drawer engine**: Vaul now, Base UI Drawer later, or Base UI Drawer during the migration.
- **Registry name and scope** for the extracted package.

## 7. What was not verified

- No `bun run build` of either app was run during the review (read-only). `bun run check`, `bun run --filter @avoid.quest/ui typecheck`, `bun run --filter @avoid.quest/radio typecheck` and the five UI-related radio test files were run by the code reviewer and passed.
- No Base UI code was generated or compiled in this repo; the mapping tables come from Base UI 1.9 docs, the shadcn migration skill and registry JSON.
- Live audit used a desktop browser at 390px width, not a touch device or screen reader. Audio playback, MIDI, permissions and feedback submission were not exercised.
- Base UI + React Compiler + TanStack Start + Astro islands in combination is undocumented; treat it as a risk to test in step 4 of section 4.

## 8. Rebase onto `dev-ui` (2026-10-21)

Twelve performance and bug-fix PRs (#430 to #441) landed on `dev-ui` after this review. Steps 1 and 2 were rebased on top of them. What they change for the plan:

| Area | What `dev-ui` did | Effect on the plan |
|---|---|---|
| Tailwind sources | `globals.css` now imports Tailwind with `source(none)` and declares no `@source`. Each consumer lists sources in its own entry: radio globs `packages/ui/src`, web lists the four components it renders to keep its CSS small. | Supersedes §4 step 1 and §5.4 item 4. The published package must not self-register sources. Ship a documented `@source` snippet per consumer instead. Storybook gets its own entry (`.storybook/storybook.css`) that adds `@source "../src"`. |
| Dark focus ring | `dark:focus-visible:ring-ring` added to 13 components; dark `--ring` lightened to `oklch(0.705 0.015 286.067)`. | Lyra regeneration must carry this. Better: §5.1 declares one `--aq-sys-focus-ring` colour that differs per theme, so the per-component `dark:` override disappears. |
| Tooltip | Provider context so nested `Tooltip` reuses the outer provider; defaults `delayDuration` and `skipDelayDuration` 300ms. | Map to Base UI `Tooltip.Provider delay` / `closeDelay`; keep the single-provider behaviour and the programmatic-focus guard. |
| Drawer | Enter 200ms, exit 140ms via `animation-duration` overrides; reduced motion stays near-instant. | Base UI Drawer swap must keep these timings. |
| Slider | Coarse-pointer `min-h-11` / `min-w-11` on the root. | First use of the 44px touch minimum; becomes `--aq-sys-touch-min` in §5.1. |
| Knob | Shift toggles fine drag without a jump (drag origin re-anchors). | Behaviour to keep; `knob.test.tsx` now lives in the package and passes. |
| PlayPauseButton | New `allowCancelWhileLoading` prop; loading label becomes "Cancel". | Add a story for the cancelable state in `feedback.stories.tsx`. |
| Slot | New `components/slot.tsx` re-exports Radix `Slot`; used by radio `settings-button.tsx`. | One more `asChild`-style site for §3. Base UI has no Slot; replace with `render` / `useRender`. |
| Web theme | Storage access is guarded; explicit toggles store `theme-preference`, system theme is followed otherwise. | Defect 7 is mostly fixed. `color-scheme` is still never set on web. |
| Radio fonts | Still none on `dev-ui`. | Step 1 keeps the Geist entry in `apps/radio/src/styles/app.css`. |
| Lazy loading | `lazyWithRetry` and `LazyBoundary` wrap the sync dialog and other chunks. | No UI-package impact. |

Validation after the rebase: `bun run check`, `bun run typecheck` (6/6), ui tests 38 pass, radio tests 3455 pass, web and radio builds, Storybook static build, 29 story tests in Chromium.
