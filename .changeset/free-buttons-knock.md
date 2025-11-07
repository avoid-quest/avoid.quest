---
"@workspace/scraper": patch
---

## Graceful Shutdown Improvements

### Signal Handling

- **Added proper SIGTERM and SIGINT handlers** to the `start` command for graceful shutdown
- **Prevents double Ctrl+C requirement** - first signal triggers graceful shutdown, subsequent signals are handled properly
- **Graceful scheduler cleanup** - stops all cron jobs before exiting
- **Shutdown flag protection** - prevents race conditions during shutdown process

### Systemd Integration

- **Updated systemd service configuration** with proper termination settings:
  - `KillMode=mixed` - sends SIGTERM to main process first
  - `TimeoutStopSec=30` - allows 30 seconds for graceful shutdown
  - `SendSIGKILL=yes` - force-kills if process doesn't exit within timeout
- **Improved service reliability** - systemd can now properly stop the service with `systemctl stop`

### User Experience

- Clear shutdown messages indicating graceful shutdown in progress
- No more hanging processes requiring multiple Ctrl+C presses
- Proper cleanup of resources before exit
