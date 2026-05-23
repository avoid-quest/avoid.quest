# config

Shared TypeScript configuration for the avoid.quest workspace.

## Exports

- `@avoid.quest/config/base` - Common strict TypeScript settings.
- `@avoid.quest/config/react-library` - React library package settings.
- Additional configs may be added here when multiple workspaces need the same TypeScript baseline.

## Usage

Extend the relevant config from an app or package `tsconfig.json`:

```json
{
  "extends": "@avoid.quest/config/base"
}
```

## Connections

- Used by apps and packages that need a shared TypeScript baseline.
