# scraper

Instagram scraper and Telegram bot integration for the avoid.quest project.

## Installation

```bash
bun install
```

## Usage

### Main Commands

Start the full system (recommended for production):

```bash
bun start
```

Run scraping job immediately:

```bash
bun scrape
```

Run telegram job immediately:

```bash
bun telegram
```

Run both scraping and telegram jobs in sequence:

```bash
bun start-both
```

### Cron Management

Start the cron scheduler:

```bash
bun run cron:start
```

Check cron job status:

```bash
bun run cron:status
```

### Other Commands

Show help:

```bash
bun help
```

Show version:

```bash
bun version
```

Run CLI with custom arguments:

```bash
bun cli <command> [options]
```

For detailed help on any command:

```bash
bun cli <command> --help
```

## Project Structure

```
src/
├── cli/              # Command-line interface
├── scraping/         # Instagram scraping logic
├── telegram/         # Telegram bot integration
├── scheduler/        # Cron job scheduling
├── settings/         # Configuration management
├── infra/            # Infrastructure utilities
└── convex/           # Database client
```

This project uses [Bun](https://bun.com) as the JavaScript runtime.
