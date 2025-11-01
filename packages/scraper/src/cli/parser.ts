import { parseArgs } from "util";
import type {
  AdminOptions,
  Command,
  CronOptions,
  CronSubcommand,
  GlobalOptions,
  ParsedArgs,
  ScrapeOptions,
  SinglePostOptions,
  StartBothOptions,
  StartOptions,
  TelegramOptions,
} from "./types";
import {
  validateLimit,
  validateMaxUsers,
  validatePostsPerProfile,
  validatePostUrl,
} from "./validators";

/**
 * Parse command line arguments using Bun's recommended util.parseArgs
 */
export function parseCommandLineArgs(): ParsedArgs {
  // Use Bun.argv for better performance and Bun-specific optimizations
  // Skip the first two arguments: Bun executable and script file
  const args = Bun.argv.slice(2);

  const { values, positionals } = parseArgs({
    args,
    options: {
      // Global options
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },

      // Scrape options
      "posts-per-profile": { type: "string" },
      "continue-on-error": { type: "boolean" },
      "use-smart-selection": { type: "boolean" },
      "max-users": { type: "string" },

      // Telegram options
      limit: { type: "string" },
      "send-only": { type: "boolean" },

      // Cron options
      start: { type: "boolean" },
      status: { type: "boolean" },
      trigger: { type: "string" },
      stop: { type: "string" },
      "start-job": { type: "string" },

      // Single post options
      url: { type: "string" },
      save: { type: "boolean" },
      "no-save": { type: "boolean" },
    },
    strict: true,
    allowPositionals: true,
  });

  // Check for version flag first - this should override everything
  if (values.version) {
    return {
      command: "version",
      subcommand: undefined,
      options: {
        verbose: values.verbose ?? false,
        help: values.help ?? false,
        version: values.version ?? false,
      },
      positionals: positionals.slice(1),
    };
  }

  const command = (positionals[0] || "help") as Command;
  const subcommand = positionals[1] as CronSubcommand | undefined;

  // Parse options based on command
  let options:
    | ScrapeOptions
    | TelegramOptions
    | CronOptions
    | StartBothOptions
    | SinglePostOptions
    | AdminOptions
    | StartOptions
    | GlobalOptions = {
    verbose: values.verbose ?? false,
    help: values.help ?? false,
  };

  if (command === "scrape") {
    options = {
      postsPerProfile: values["posts-per-profile"]
        ? Number.parseInt(values["posts-per-profile"], 10)
        : undefined,
      continueOnError: values["continue-on-error"] ?? true,
      useSmartSelection: values["use-smart-selection"] ?? true,
      maxUsers: values["max-users"]
        ? Number.parseInt(values["max-users"], 10)
        : undefined,
      verbose: values.verbose ?? false,
      help: values.help ?? false,
    };
  } else if (command === "telegram") {
    options = {
      limit: values.limit ? Number.parseInt(values.limit, 10) : undefined,
      sendOnly: values["send-only"] ?? false,
      verbose: values.verbose ?? false,
      help: values.help ?? false,
    };
  } else if (command === "cron") {
    options = {
      start: values.start ?? false,
      status: values.status ?? false,
      trigger: values.trigger,
      stop: values.stop,
      startJob: values["start-job"],
      verbose: values.verbose ?? false,
      help: values.help ?? false,
    };
  } else if (command === "start-both") {
    options = {
      postsPerProfile: values["posts-per-profile"]
        ? Number.parseInt(values["posts-per-profile"], 10)
        : undefined,
      continueOnError: values["continue-on-error"] ?? true,
      useSmartSelection: values["use-smart-selection"] ?? true,
      maxUsers: values["max-users"]
        ? Number.parseInt(values["max-users"], 10)
        : undefined,
      limit: values.limit ? Number.parseInt(values.limit, 10) : undefined,
      sendOnly: values["send-only"] ?? false,
      verbose: values.verbose ?? false,
      help: values.help ?? false,
    };
  } else if (command === "single-post") {
    options = {
      url: values.url,
      save: values["no-save"] ? false : (values.save ?? true),
      verbose: values.verbose ?? false,
      help: values.help ?? false,
    };
  } else if (command === "admin" || command === "start") {
    options = {
      verbose: values.verbose ?? false,
      help: values.help ?? false,
    };
  }

  return {
    command,
    subcommand,
    options,
    positionals: positionals.slice(1), // Remove command from positionals
  };
}

/**
 * Validate command structure and arguments
 */
export function validateCommand(args: ParsedArgs): {
  isValid: boolean;
  error?: string;
} {
  const { command, subcommand, options } = args;

  // Validate main command
  const validCommands: Command[] = [
    "start",
    "scrape",
    "telegram",
    "cron",
    "start-both",
    "admin",
    "user",
    "single-post",
    "settings",
    "help",
    "version",
  ];
  if (!validCommands.includes(command as Command)) {
    return {
      isValid: false,
      error: `❌ Invalid command: '${command}'\n\nAvailable commands: ${validCommands.join(", ")}\n\nRun 'bun run src/cli/index.ts --help' for more information.`,
    };
  }

  // Validate cron subcommands
  if (command === "cron") {
    const validSubcommands: CronSubcommand[] = [
      "start",
      "status",
      "trigger",
      "stop",
      "start-job",
    ];
    if (
      subcommand &&
      !validSubcommands.includes(subcommand as CronSubcommand)
    ) {
      return {
        isValid: false,
        error: `❌ Invalid cron subcommand: '${subcommand}'\n\nAvailable subcommands: ${validSubcommands.join(", ")}\n\nRun 'bun run src/cli.ts cron --help' for more information.`,
      };
    }
  }

  // Validate numeric options
  if (command === "scrape") {
    const scrapeOptions = options as ScrapeOptions;
    if (scrapeOptions.postsPerProfile) {
      const validation = validatePostsPerProfile(scrapeOptions.postsPerProfile);
      if (!validation.isValid) {
        return validation;
      }
    }
    if (scrapeOptions.maxUsers) {
      const validation = validateMaxUsers(scrapeOptions.maxUsers);
      if (!validation.isValid) {
        return validation;
      }
    }
  }

  if (command === "telegram") {
    const telegramOptions = options as TelegramOptions;
    if (telegramOptions.limit) {
      const validation = validateLimit(telegramOptions.limit);
      if (!validation.isValid) {
        return validation;
      }
    }
  }

  if (command === "start-both") {
    const startBothOptions = options as StartBothOptions;

    // Validate posts-per-profile
    if (startBothOptions.postsPerProfile) {
      const validation = validatePostsPerProfile(
        startBothOptions.postsPerProfile
      );
      if (!validation.isValid) {
        return validation;
      }
    }

    // Validate limit
    if (startBothOptions.limit) {
      const validation = validateLimit(startBothOptions.limit);
      if (!validation.isValid) {
        return validation;
      }
    }
  }

  if (command === "single-post") {
    const singlePostOptions = options as SinglePostOptions;
    // Skip validation if help is requested
    if (!singlePostOptions.help) {
      if (!singlePostOptions.url) {
        return {
          isValid: false,
          error: "❌ --url is required for single-post command",
        };
      }
      const urlValidation = validatePostUrl(singlePostOptions.url);
      if (!urlValidation.isValid) {
        return urlValidation;
      }
    }
  }

  return { isValid: true };
}

