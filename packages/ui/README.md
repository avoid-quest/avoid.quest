# ui

Shared React UI component library for the main avoid.quest workspace.

## Features

- **Components**: button, card, input, textarea, select, dialog, dropdown, tabs, carousel, accordion, avatar, badge, skeleton, tooltip, slider, switch, separator, popover, and more.
- **Theme**: dark/light mode via `next-themes`, CSS variables, and OKLCH color space.
- **Custom components**: avoid logo, site logo, mode toggle, rotary knob, play/pause button, and user avatar.
- **Utilities**: `cn()` for Tailwind class merging.
- **Assets**: favicons and icons exported from the package.

## Usage

```typescript
import { Button, Card, Input } from "@avoid.quest/ui/components";
import { cn } from "@avoid.quest/ui/lib/utils";
```

## Adding components

```bash
# From the repository root
bun run ui add <component-name>
```

## Connections

- Used by **apps/web** for branding, buttons, and theme controls.
- Used by **apps/radio** for forms, dialogs, sliders, and settings UI.
- Copied into the split `cwavasape` and `instarip` repositories as their local UI package.
