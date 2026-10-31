# ui

Shared React UI component library for the main avoid.quest workspace.

## Features

- **Components**: forms, layout, navigation, overlays, and feedback primitives, each with a component entry in Storybook.
- **Theme**: dark/light mode via `next-themes`, CSS variables, and OKLCH color space.
- **Custom components**: avoid logo, GitHub icon, rotary knob, play/pause button, legal page, and changelog ("What's new" popover with an unread dot).
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

Components use Base UI primitives with the preset's Sera styling and Tabler icons.
Button variants, the rotary knob, and the audio slider's fader styles keep their
local behavior and styling. The settings drawer continues to use Vaul.
Use `render={<Component />}` for composition. Select roots supply `items` for
labels before the popup opens, and single-select callbacks handle `null`.

## Adding components

```bash
# From the repository root
bun run ui add <component-name>
```

## Storybook

The shared catalog lives in [`apps/storybook`](../../apps/storybook/README.md),
which owns the Storybook config, its dependencies and the story tests. This
package keeps only its story sources. All 38 component modules have a matching
`src/stories/<component>.stories.tsx`, listed flat and alphabetically under
`Components/<ComponentName>`; `Foundations/Theme` covers the theme itself.

Each entry has generated Autodocs. Name a story `Default` for the normal
baseline, and name others after a specific state or variant (`Disabled`,
`Vertical`, `OpenedFromMenu`). Put interaction checks in `play` functions.
Toast stories dismiss their notifications on cleanup, and changelog stories
restore their own storage key.

`storybook` and `@storybook/react-vite` stay dev dependencies here, through the
root catalog, so this package typechecks its stories on its own. The package
never imports `apps/storybook` or `apps/radio`, and nothing exports a story.

`Foundations/Theme` checks that the theme global, next-themes provider, document
class, preset background, loaded font, and accessibility policy are applied during
story tests. Its State Colours story shows all four semantic states and their
foreground pairs in each theme.

`Components/PlayPauseButton/Cancelable Loading` checks the "Cancel Cashmere Radio"
accessible name, keyboard focus, and clicking to return to the play state.

## Connections

- Used by **apps/web** for branding, buttons, and the legal page.
- Used by **apps/radio** for forms, dialogs, sliders, and settings UI.
