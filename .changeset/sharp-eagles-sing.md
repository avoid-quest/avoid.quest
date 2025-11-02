---
"@workspace/scraper": patch
---

Enhanced scheduler with comprehensive logging and visibility

## Added

- **Logging system integration**: Scheduler now uses the logger infrastructure with `DEBUG=1` environment variable support
- **Settings visibility**: Logs loaded settings at debug level (scraper/telegram active status, cron expressions)
- **Job creation logging**: Logs success/failure when creating cron jobs with next run times
- **Error handling**: Added try-catch blocks in cron job callbacks with detailed error logging and stack traces
- **Next runs display**: Added "Next Runs" section in `start` command showing when scraper and telegram jobs are scheduled
- **Status API**: Exported `getSchedulerStatus()`, `getScraperNextRun()`, and `getTelegramNextRun()` functions for status queries

## Improved

- **Debugging experience**: Full visibility into why jobs aren't running (missing settings, invalid cron expressions, execution errors)
- **Error recovery**: Cron job failures no longer crash the scheduler - errors are logged and execution continues
- **User feedback**: Clear indication of job status and next scheduled runs on startup
