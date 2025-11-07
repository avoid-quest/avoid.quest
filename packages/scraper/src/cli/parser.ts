import { parseArgs } from "node:util";
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

type ParsedValues = {
  verbose?: boolean;
  help?: boolean;
  version?: boolean;
  "posts-per-profile"?: string;
  "continue-on-error"?: boolean;
  "use-smart-selection"?: boolean;
  "max-users"?: string;
  limit?: string;
  "send-only"?: boolean;
  start?: boolean;
  status?: boolean;
  trigger?: string;
  stop?: string;
  "start-job"?: string;
  url?: string;
  save?: boolean;
  "no-save"?: boolean;
};

function parseScrapeOptions(values: ParsedValues): ScrapeOptions {
  return {
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
}

function parseTelegramOptions(values: ParsedValues): TelegramOptions {
  return {
    limit: values.limit ? Number.parseInt(values.limit, 10) : undefined,
    sendOnly: values["send-only"] ?? false,
    verbose: values.verbose ?? false,
    help: values.help ?? false,
  };
}

function parseCronOptions(values: ParsedValues): CronOptions {
  return {
    start: values.start ?? false,
    status: values.status ?? false,
    trigger: values.trigger,
    stop: values.stop,
    startJob: values["start-job"],
    verbose: values.verbose ?? false,
    help: values.help ?? false,
  };
}

function parseStartBothOptions(values: ParsedValues): StartBothOptions {
  return {
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
}

function parseSinglePostOptions(values: ParsedValues): SinglePostOptions {
  return {
    url: values.url,
    save: values["no-save"] ? false : (values.save ?? true),
    verbose: values.verbose ?? false,
    help: values.help ?? false,
  };
}

function parseGlobalOptions(values: ParsedValues): GlobalOptions {
  return {
    verbose: values.verbose ?? false,
    help: values.help ?? false,
  };
}

function parseOptionsForCommand(
  command: Command,
  values: ParsedValues
):
  | ScrapeOptions
  | TelegramOptions
  | CronOptions
  | StartBothOptions
  | SinglePostOptions
  | AdminOptions
  | StartOptions
  | GlobalOptions {
  switch (command) {
    case "scrape":
      return parseScrapeOptions(values);
    case "telegram":
      return parseTelegramOptions(values);
    case "cron":
      return parseCronOptions(values);
    case "start-both":
      return parseStartBothOptions(values);
    case "single-post":
      return parseSinglePostOptions(values);
    case "admin":
    case "start":
      return parseGlobalOptions(values);
    default:
      return parseGlobalOptions(values);
  }
}

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
  const options = parseOptionsForCommand(command, values as ParsedValues);

  return {
    command,
    subcommand,
    options,
    positionals: positionals.slice(1), // Remove command from positionals
  };
}

function validateMainCommand(command: string): {
  isValid: boolean;
  error?: string;
} {
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
  return { isValid: true };
}

function validateCronSubcommand(subcommand: string | undefined): {
  isValid: boolean;
  error?: string;
} {
  if (!subcommand) {
    return { isValid: true };
  }
  const validSubcommands: CronSubcommand[] = [
    "start",
    "status",
    "trigger",
    "stop",
    "start-job",
  ];
  if (!validSubcommands.includes(subcommand as CronSubcommand)) {
    return {
      isValid: false,
      error: `❌ Invalid cron subcommand: '${subcommand}'\n\nAvailable subcommands: ${validSubcommands.join(", ")}\n\nRun 'bun run src/cli.ts cron --help' for more information.`,
    };
  }
  return { isValid: true };
}

function validateScrapeCommand(options: ScrapeOptions): {
  isValid: boolean;
  error?: string;
} {
  if (options.postsPerProfile) {
    const validation = validatePostsPerProfile(options.postsPerProfile);
    if (!validation.isValid) {
      return validation;
    }
  }
  if (options.maxUsers) {
    const validation = validateMaxUsers(options.maxUsers);
    if (!validation.isValid) {
      return validation;
    }
  }
  return { isValid: true };
}

function validateTelegramCommand(options: TelegramOptions): {
  isValid: boolean;
  error?: string;
} {
  if (options.limit) {
    const validation = validateLimit(options.limit);
    if (!validation.isValid) {
      return validation;
    }
  }
  return { isValid: true };
}

function validateStartBothCommand(options: StartBothOptions): {
  isValid: boolean;
  error?: string;
} {
  if (options.postsPerProfile) {
    const validation = validatePostsPerProfile(options.postsPerProfile);
    if (!validation.isValid) {
      return validation;
    }
  }
  if (options.limit) {
    const validation = validateLimit(options.limit);
    if (!validation.isValid) {
      return validation;
    }
  }
  return { isValid: true };
}

function validateSinglePostCommand(options: SinglePostOptions): {
  isValid: boolean;
  error?: string;
} {
  if (options.help) {
    return { isValid: true };
  }
  if (!options.url) {
    return {
      isValid: false,
      error: "❌ --url is required for single-post command",
    };
  }
  return validatePostUrl(options.url);
}

function validateCommandOptions(
  command: Command,
  options: ParsedArgs["options"]
): { isValid: boolean; error?: string } {
  switch (command) {
    case "scrape":
      return validateScrapeCommand(options as ScrapeOptions);
    case "telegram":
      return validateTelegramCommand(options as TelegramOptions);
    case "start-both":
      return validateStartBothCommand(options as StartBothOptions);
    case "single-post":
      return validateSinglePostCommand(options as SinglePostOptions);
    default:
      return { isValid: true };
  }
}

/**
 * Validate command structure and arguments
 */
export function validateCommand(args: ParsedArgs): {
  isValid: boolean;
  error?: string;
} {
  const { command, subcommand, options } = args;

  const commandValidation = validateMainCommand(command);
  if (!commandValidation.isValid) {
    return commandValidation;
  }

  if (command === "cron") {
    const subcommandValidation = validateCronSubcommand(subcommand);
    if (!subcommandValidation.isValid) {
      return subcommandValidation;
    }
  }

  return validateCommandOptions(command, options);
}
