# ui

Shared React UI component library for the main avoid.quest workspace.

## Features

- **Components**: button, card, input, textarea, select, dialog, dropdown, tabs, carousel, accordion, avatar, badge, skeleton, tooltip, slider, switch, separator, popover, and more.
- **Theme**: dark/light mode via `next-themes`, CSS variables, and OKLCH color space.
- **Custom components**: avoid logo, site logo, mode toggle, rotary knob, play/pause button, user avatar, and changelog ("What's new" popover with an unread dot).
- **Utilities**: `cn()` for Tailwind class merging.
- **Assets**: favicons and icons exported from the package.

## Usage

```typescript
import { Button } from "@avoid.quest/ui/components/button";
import { Card } from "@avoid.quest/ui/components/card";
import { Input } from "@avoid.quest/ui/components/input";
import { cn } from "@avoid.quest/ui/lib/utils";
```

## Theme

The theme values come from [shadcn preset `beXRToEi`](https://ui.shadcn.com/create?preset=beXRToEi):
Zinc surfaces, the default `0.625rem` radius, and Geist Mono Variable for body,
heading, and mono text. `globals.css` loads the font, so apps and Storybook share
the same typography without separate font imports. Buttons use pointer cursors.
Success, warning, info, and destructive each have a foreground pair in both themes.

Only the preset's theme and font are applied here. The existing Radix components
and Lucide icons remain until the separate Base UI migration; the preset's Sera
component styling and Tabler icons belong to that migration.

## Adding components

```bash
# From the repository root
bun run ui add <component-name>
```

## Story tests

From the repository root, run `bun run --filter @avoid.quest/ui test:stories`.
This runs every story and its interaction tests in headless Chromium twice:
`storybook-light` and `storybook-dark`. Each project pins `initialGlobals.theme`
and loads `.storybook/vitest.setup.ts`, which applies the preview stylesheet,
theme decorators, and accessibility addon hooks. The preview's `a11y.test: "error"`
makes axe violations fail the run in either theme.

PR validation installs Chromium and runs this same command after the workspace
unit tests, so interaction and accessibility failures in either theme block CI.

`Foundations/Theme` checks that the theme global, next-themes provider, document
class, preset background, loaded font, and accessibility policy are applied during
these tests. Its State Colours story shows all four semantic states and their
foreground pairs in each theme.

`Primitives/Feedback/Cancelable Loading` checks the "Cancel Cashmere Radio"
accessible name, keyboard focus, and clicking to return to the play state.

## Connections

- Used by **apps/web** for branding, buttons, and theme controls.
- Used by **apps/radio** for forms, dialogs, sliders, and settings UI.
