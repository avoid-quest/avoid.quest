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
class, stylesheet, and accessibility policy are applied during these tests.

`Primitives/Feedback/Cancelable Loading` checks the "Cancel Cashmere Radio"
accessible name, keyboard focus, and clicking to return to the play state.

## Connections

- Used by **apps/web** for branding, buttons, and theme controls.
- Used by **apps/radio** for forms, dialogs, sliders, and settings UI.
