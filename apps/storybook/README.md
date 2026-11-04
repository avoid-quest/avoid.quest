# storybook

One Storybook for the workspace: the shared UI components from
`packages/ui` and Radio's own components from `apps/radio`. This private
workspace owns the Storybook and Vitest config, their dependencies and the
catalog stylesheet. Story sources stay with the code they describe.

## Commands

From the repository root:

```bash
bun run --filter @avoid.quest/storybook storybook        # dev server on :6006
bun run --filter @avoid.quest/storybook build-storybook  # static build
bun run --filter @avoid.quest/storybook test:stories     # story tests
```

Pass `--no-open` after `storybook` to keep the browser closed.

## Sidebar

| Group | Source |
| --- | --- |
| `Foundations/Theme` | `packages/ui/src/stories/theme.stories.tsx` |
| `Components/<ComponentName>` | `packages/ui/src/stories/*.stories.tsx`, one per component module |
| `Radio/Features/<Name>` | Radio components, beside them in `apps/radio/src/components/**` |
| `Radio/Shell/<Name>` | The app frame (`AppFrame`) |
| `Radio/Views/<Name>` | Whole pages inside `AppFrame`: loading, error, not found |

Radio stories render real app components with typed, offline fixtures. Their
fixtures, decorators and stubs are app-owned, in `apps/radio/src/storybook`:

- `withRadioQueryClient` gives each story a fresh query cache.
- `withRadioRouter` gives router links a memory router with one root route.
  The generated route tree is never mounted.
- `seedRadioSettings` writes fixture settings through the live TanStack DB
  collection, marks the fixture changelog seen, and restores both afterwards.
- `withAppFrame` renders a story as a page inside `AppFrame`.

`RootShell` is not mounted: the document, analytics, MIDI, service worker,
install prompt and bootstrap stay out of Storybook.

## Vite config

Storybook does not reuse Radio's Vite config (TanStack Start, Cloudflare,
Sentry, worklets). `.storybook/main.ts` adds only Tailwind, the React Compiler
the apps use, and these Radio-scoped substitutions:

- `@/` resolves to `apps/radio/src`.
- `virtual:changelog` and `__CHANGELOG_NEWEST_DATE__` come from
  `changelog.fixture.ts`; `__APP_VERSION__` is Radio's package version.
- `@/lib/mode-lifecycle-requests` becomes an idle stub, so no mode starts an
  audio engine.
- `@/utils/*.functions` become stubs that reject, so server functions never
  run or reach the network.

`.storybook/storybook.css` imports the shared stylesheet and lists both source
trees for Tailwind. Radio adds utilities only; it changes no shared base styles.

## Story tests

`test:stories` runs every story and its `play` function in headless Chromium
twice, as `storybook-light` and `storybook-dark`. The preview's
`a11y.test: "error"` fails either run on an axe violation. There are no component-specific exemptions.

Install the browser once with `bunx playwright install chromium` from this
directory. PR validation installs it and runs the same command.

Turbo hashes both story trees for `build-storybook` (see `turbo.json`).
