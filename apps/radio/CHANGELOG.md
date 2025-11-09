# radio

## 0.1.1

### Patch Changes

- b08ef94: ### Infrastructure

  - Simplified and improved GitHub Actions release workflow to use path filters in the `on` section, preventing unnecessary workflow runs when no package changes are detected
  - Enhanced release automation to properly handle both PR creation (when changesets exist) and npm publishing (when versions are ahead of published versions)
  - Workflow now relies on changesets action's built-in logic for better reliability and maintainability

- Updated dependencies [b08ef94]
  - @avoid.quest/cacophony@0.18.3
