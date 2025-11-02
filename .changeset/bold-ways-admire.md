---
"@workspace/scraper": patch
---

Fix croner API bug and add comprehensive test suite

- **Fixed**: Replaced incorrect `.next()` method calls with `.nextRun()` to match croner v9.1.0 API
- **Added**: Comprehensive test suite for scheduler module using Bun's test framework
- **Added**: Test script (`bun test`) to package.json
- **Added**: GitHub Actions CI workflow for automated testing on push/PR
- **Improved**: Code structure by extracting helper functions to reduce complexity
- **Improved**: Type safety by removing unnecessary optional chaining and type casts
- **Improved**: Removed magic numbers by extracting time constants

All tests passing (15/15). The scheduler now correctly handles cron job creation, error handling, and state management.
