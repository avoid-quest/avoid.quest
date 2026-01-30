# ui

Shared UI component library. shadcn/ui + Radix UI primitives.

## Features

- **Components**: button, card, input, textarea, select, dialog, dropdown, tabs, carousel, accordion, avatar, badge, skeleton, tooltip, slider, switch, separator, popover, and more
- **Theme**: Dark/light mode via next-themes, CSS variables, OKLCH color space
- **Custom components**: avoid-logo, site-logo, mode-toggle, rotary-knob, play-pause-button, user-avatar
- **Utilities**: `cn()` for Tailwind class merging
- **Assets**: Favicons and icons exported from package

## Usage

```typescript
import { Button, Card, Input } from "@avoid.quest/ui/components";
import { cn } from "@avoid.quest/ui/lib/utils";
```

## Adding Components

```bash
# From monorepo root
bun run ui add <component-name>
```

## Connections

- Used by **apps/instarip**: Cards, buttons, carousel, lightbox
- Used by **apps/radio**: Form inputs, dialogs, sliders, settings
- Used by **apps/cwavasape**: Sliders, selects, tabs, settings panel
- Used by **apps/web**: Logo, buttons, theme toggle
