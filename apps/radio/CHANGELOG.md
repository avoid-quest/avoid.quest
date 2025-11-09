# radio

## 0.1.3

### Patch Changes

- 5486a5c: feat: enhance PWA functionality and layout

  - Added InstallPrompt component to prompt users for PWA installation.
  - Updated service worker registration logic to include production checks and improved scope handling.
  - Modified service worker to skip waiting during activation and ensure immediate control over clients.
  - Updated layout metadata with additional meta tags for better PWA support.

## 0.1.1

### Patch Changes

- b08ef94: ### Infrastructure

  - Simplified and improved GitHub Actions release workflow to use path filters in the `on` section, preventing unnecessary workflow runs when no package changes are detected
  - Enhanced release automation to properly handle both PR creation (when changesets exist) and npm publishing (when versions are ahead of published versions)
  - Workflow now relies on changesets action's built-in logic for better reliability and maintainability

- Updated dependencies [b08ef94]
  - @avoid.quest/cacophony@0.18.3
