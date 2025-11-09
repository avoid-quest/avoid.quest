# @avoid.quest/cacophony

## 0.17.0

### Minor Changes

- ### Added

  - Added MIT LICENSE file with proper attribution to original Cacophony library by @ctoth
  - Added repository, homepage, and author metadata to package.json
  - Added `publishConfig` for public npm publishing under `@avoid.quest` scope
  - Added changesets release pipeline with automated versioning and publishing
  - Added GitHub Actions workflow for automated releases via changesets
  - Added attribution note in README crediting original Cacophony library

  ### Changed

  - Renamed package from `@workspace/cacophony` to `@avoid.quest/cacophony`
  - Updated all internal references to use new package name
  - Updated changesets config to use `"access": "public"` for scoped package publishing
  - Updated turbo.json to include `dist/**` in build outputs
  - Migrated build system to use Bun instead of Node.js/npm

  ### Infrastructure

  - Set up automated release workflow using changesets/action
  - Added npm publishing scripts: `changeset`, `version-packages`, and `release`
  - Configured package for public npm distribution under `@avoid.quest` scope
